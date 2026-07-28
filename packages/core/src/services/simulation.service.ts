import type { DataSource, EntityManager } from 'typeorm';
import { In } from 'typeorm';
import { CopiedPosition } from '../entities/CopiedPosition.js';
import { Execution } from '../entities/Execution.js';
import { MoveEventEntity } from '../entities/MoveEvent.js';
import { PositionReservation } from '../entities/PositionReservation.js';
import { RiskConfig } from '../entities/RiskConfig.js';
import { SimulationBalance } from '../entities/SimulationBalance.js';
import { marketLifecycleFromEntity } from '../market/lifecycle.js';
import {
  computePositionUnrealizedPnl,
  OPEN_LIKE_POSITION_STATUSES,
  sumOpenPositionsValue,
} from '../positions/mark.js';
import { DEFAULT_SIM_BALANCE } from '../simulation/constants.js';
import {
  replaySimCashDelta,
  type SimExecutionCashRow,
} from '../simulation/accounting.js';
import { algoKindFromReason, type SimAlgoKind } from '../simulation/algo-kind.js';
import {
  getSimInitialCapital,
  setSimInitialCapital,
} from '../simulation/sim-initial-capital.js';
import { MarketService } from './market.service.js';

export { DEFAULT_SIM_BALANCE };

const CASH_DRIFT_TOLERANCE = 0.01;
const FILLED_EXEC_STATUSES = ['filled', 'partial', 'no_payout'] as const;

export function resolveSimResetAmount(
  requestedAmount: unknown,
  simInitialCapital?: number | null,
): number {
  if (requestedAmount != null && requestedAmount !== '') {
    const amount = Number(requestedAmount);
    if (Number.isFinite(amount) && amount > 0) return amount;
  }
  return simInitialCapital ?? DEFAULT_SIM_BALANCE;
}

export interface SimulationSnapshot {
  amount: number;
  token: string;
  positionsValue: number;
  equity: number;
  openPnlSum: number;
  closedPnlSum: number;
  baselineCapital: number;
}

export interface CashIntegrityResult {
  repaired: boolean;
  drift: number;
  expectedCash: number;
  baselineCapital: number;
}

export class SimulationService {
  private marketService: MarketService;

  constructor(private readonly ds: DataSource) {
    this.marketService = new MarketService(ds);
  }

  async getCashAmount(algoKind: SimAlgoKind, manager?: EntityManager): Promise<number> {
    const repo = (manager ?? this.ds.manager).getRepository(SimulationBalance);
    const balance = await repo.findOne({ where: { algoKind } });
    return balance?.amount ?? 0;
  }

  /** Apply a signed cash delta from a finalized execution (sim mode only). */
  async adjustCash(delta: number, algoKind: SimAlgoKind, manager?: EntityManager): Promise<void> {
    const run = async (m: EntityManager): Promise<void> => {
      const repo = m.getRepository(SimulationBalance);
      let balance = await repo.findOne({ where: { algoKind } });
      if (!balance) {
        const risk = await m.getRepository(RiskConfig).findOne({ where: {} });
        const baseline = getSimInitialCapital(risk, algoKind);
        balance = await repo.save(
          repo.create({
            algoKind,
            token: 'pUSD',
            amount: baseline,
            baselineCapital: baseline,
            sessionStartedAt: new Date(),
          }),
        );
      }
      balance.amount = Math.max(0, balance.amount + delta);
      await repo.save(balance);
    };
    if (manager) return run(manager);
    return this.ds.transaction(run);
  }

  private async loadFilledSimExecutions(
    algoKind: SimAlgoKind,
    manager: EntityManager,
  ): Promise<SimExecutionCashRow[]> {
    // 1. Get copiedPositionIds whose opening reason maps to this algoKind
    const positions = await manager.getRepository(CopiedPosition)
      .createQueryBuilder('p')
      .select(['p.id', 'p.reason'])
      .where('p.mode = :mode', { mode: 'sim' })
      .getMany();
    const matchingIds = positions
      .filter((p) => algoKindFromReason(p.reason) === algoKind)
      .map((p) => p.id);
    if (matchingIds.length === 0) return [];

    // 2. Load executions for those positions
    const rows = await manager.getRepository(Execution).find({
      where: { mode: 'sim', status: In([...FILLED_EXEC_STATUSES]), copiedPositionId: In(matchingIds) },
      order: { executedAt: 'ASC', id: 'ASC' },
    });

    return rows.map((ex) => ({
      copiedPositionId: ex.copiedPositionId,
      side: ex.side as 'BUY' | 'SELL',
      reason: ex.reason,
      fillPrice: ex.fillPrice ?? 0,
      fillQuantity: ex.fillQuantity ?? 0,
      fees: ex.fees ?? 0,
    }));
  }

  private async resolveBaselineCapital(
    balance: SimulationBalance,
    manager: EntityManager,
  ): Promise<number> {
    if (balance.baselineCapital != null && balance.baselineCapital > 0) {
      return balance.baselineCapital;
    }
    const risk = await manager.getRepository(RiskConfig).findOne({ where: {} });
    return getSimInitialCapital(risk, balance.algoKind);
  }

  async computeExpectedCash(algoKind: SimAlgoKind, manager?: EntityManager): Promise<{
    expectedCash: number;
    baselineCapital: number;
    netCashDelta: number;
  }> {
    const m = manager ?? this.ds.manager;
    const balance = await m.getRepository(SimulationBalance).findOne({ where: { algoKind } });
    const baselineCapital = balance
      ? await this.resolveBaselineCapital(balance, m)
      : DEFAULT_SIM_BALANCE;
    const netCashDelta = replaySimCashDelta(await this.loadFilledSimExecutions(algoKind, m));
    return {
      expectedCash: baselineCapital + netCashDelta,
      baselineCapital,
      netCashDelta,
    };
  }

  /**
   * Align stored cash with baseline + replayed execution ledger.
   * If algoKind is provided, only checks/repairs that line.
   * If omitted, loops over all 3 algoKind.
   */
  async ensureCashIntegrity(
    algoKind?: SimAlgoKind,
    manager?: EntityManager,
  ): Promise<CashIntegrityResult> {
    if (algoKind) {
      return this.ensureCashIntegrityForAlgo(algoKind, manager);
    }
    // Loop over all 3 — return the last result (caller should check each individually)
    let result: CashIntegrityResult = { repaired: false, drift: 0, expectedCash: 0, baselineCapital: 0 };
    for (const ak of ['crypto', 'weather', 'copy'] as const) {
      result = await this.ensureCashIntegrityForAlgo(ak, manager);
    }
    return result;
  }

  private async ensureCashIntegrityForAlgo(
    algoKind: SimAlgoKind,
    manager?: EntityManager,
  ): Promise<CashIntegrityResult> {
    const run = async (m: EntityManager): Promise<CashIntegrityResult> => {
      const repo = m.getRepository(SimulationBalance);
      let balance = await repo.findOne({ where: { algoKind } });
      if (!balance) {
        const risk = await m.getRepository(RiskConfig).findOne({ where: {} });
        const baseline = getSimInitialCapital(risk, algoKind);
        balance = await repo.save(
          repo.create({
            algoKind,
            token: 'pUSD',
            amount: baseline,
            baselineCapital: baseline,
            sessionStartedAt: new Date(),
          }),
        );
        const netCashDelta = replaySimCashDelta(
          await this.loadFilledSimExecutions(algoKind, m),
        );
        const expectedCash = baseline + netCashDelta;
        balance.amount = expectedCash;
        await repo.save(balance);
        return {
          repaired: false,
          drift: 0,
          expectedCash,
          baselineCapital: baseline,
        };
      }

      const baselineCapital = await this.resolveBaselineCapital(balance, m);
      if (balance.baselineCapital == null) {
        balance.baselineCapital = baselineCapital;
      }

      const netCashDelta = replaySimCashDelta(await this.loadFilledSimExecutions(algoKind, m));
      const expectedCash = baselineCapital + netCashDelta;
      const drift = balance.amount - expectedCash;

      if (Math.abs(drift) > CASH_DRIFT_TOLERANCE) {
        balance.amount = expectedCash;
        await repo.save(balance);
        return { repaired: true, drift, expectedCash, baselineCapital };
      }

      if (balance.baselineCapital !== baselineCapital) {
        await repo.save(balance);
      }

      return { repaired: false, drift, expectedCash, baselineCapital };
    };

    if (manager) return run(manager);
    return this.ds.transaction(run);
  }

  async getSnapshot(algoKind: SimAlgoKind, manager?: EntityManager): Promise<SimulationSnapshot> {
    const m = manager ?? this.ds.manager;
    const balance = await m.getRepository(SimulationBalance).findOne({
      where: { algoKind },
    });
    const amount = balance?.amount ?? 0;
    const token = balance?.token ?? 'pUSD';
    const { baselineCapital } = await this.computeExpectedCash(algoKind, m);

    const allOpenLikePositions = await m.getRepository(CopiedPosition).find({
      where: OPEN_LIKE_POSITION_STATUSES.map((status) => ({
        mode: 'sim' as const,
        status,
      })),
    });
    const openLikePositions = allOpenLikePositions.filter(
      (p) => algoKindFromReason(p.reason) === algoKind,
    );

    const allClosedPositions = await m.getRepository(CopiedPosition).find({
      where: { mode: 'sim', status: 'closed' },
    });
    const closedPositions = allClosedPositions.filter(
      (p) => algoKindFromReason(p.reason) === algoKind,
    );

    const conditionIds = [...new Set(openLikePositions.map((p) => p.conditionId))];
    const marketRows = await this.marketService.loadByConditionIds(conditionIds);
    const lifecycleByCondition = new Map(
      [...marketRows.entries()].map(([id, m]) => [
        id,
        marketLifecycleFromEntity(m),
      ]),
    );

    const positionsValue = sumOpenPositionsValue(
      openLikePositions,
      lifecycleByCondition,
    );

    const openPnlSum = openLikePositions.reduce((sum, p) => {
      const market = lifecycleByCondition.get(p.conditionId);
      return sum + computePositionUnrealizedPnl(p, market ?? null);
    }, 0);

    const closedPnlSum = closedPositions.reduce(
      (sum, p) => sum + (p.realizedPnl ?? 0),
      0,
    );

    return {
      amount,
      token,
      positionsValue,
      equity: amount + positionsValue,
      openPnlSum,
      closedPnlSum,
      baselineCapital,
    };
  }

  /**
   * Aggregate snapshot summing all 3 algoKind lines.
   * Used by session rotation and archives for the global view.
   */
  async getGlobalSnapshot(manager?: EntityManager): Promise<SimulationSnapshot> {
    const m = manager ?? this.ds.manager;
    const crypto = await this.getSnapshot('crypto', m);
    const weather = await this.getSnapshot('weather', m);
    const copy = await this.getSnapshot('copy', m);
    return {
      amount: crypto.amount + weather.amount + copy.amount,
      token: 'pUSD',
      positionsValue: crypto.positionsValue + weather.positionsValue + copy.positionsValue,
      equity: crypto.equity + weather.equity + copy.equity,
      openPnlSum: crypto.openPnlSum + weather.openPnlSum + copy.openPnlSum,
      closedPnlSum: crypto.closedPnlSum + weather.closedPnlSum + copy.closedPnlSum,
      baselineCapital: crypto.baselineCapital + weather.baselineCapital + copy.baselineCapital,
    };
  }

  async reset(algoKind: SimAlgoKind, amount = DEFAULT_SIM_BALANCE): Promise<SimulationSnapshot> {
    await this.ds.transaction(async (manager) => {
      await this.resetWithManager(algoKind, manager, amount);
    });
    return this.getSnapshot(algoKind);
  }

  async resetWithManager(
    algoKind: SimAlgoKind,
    manager: EntityManager,
    amount = DEFAULT_SIM_BALANCE,
  ): Promise<void> {
    const allPositions = await manager.getRepository(CopiedPosition).find({
      where: { mode: 'sim' },
    });
    const matchingPosIds = allPositions
      .filter((p) => algoKindFromReason(p.reason) === algoKind)
      .map((p) => p.id);

    if (matchingPosIds.length > 0) {
      await manager.delete(Execution, { copiedPositionId: In(matchingPosIds) });
      await manager.delete(CopiedPosition, { id: In(matchingPosIds) });
    }

    const reservations = await manager.getRepository(PositionReservation).find({
      where: { mode: 'sim' },
    });
    const matchingResIds = reservations
      .filter((r) => algoKindFromReason(r.reason) === algoKind)
      .map((r) => r.id);
    if (matchingResIds.length > 0) {
      await manager.delete(PositionReservation, { id: In(matchingResIds) });
    }

    if (algoKind === 'copy') {
      await manager
        .getRepository(MoveEventEntity)
        .createQueryBuilder()
        .update()
        .set({ processed: true })
        .where('processed = :processed', { processed: false })
        .execute();
    }

    const repo = manager.getRepository(SimulationBalance);
    const sessionStartedAt = new Date();
    let balance = await repo.findOne({ where: { algoKind } });
    if (!balance) {
      balance = repo.create({
        algoKind,
        token: 'pUSD',
        amount,
        baselineCapital: amount,
        sessionStartedAt,
      });
    } else {
      balance.amount = amount;
      balance.baselineCapital = amount;
      balance.sessionStartedAt = sessionStartedAt;
    }
    await repo.save(balance);

    const riskRepo = manager.getRepository(RiskConfig);
    const risk = await riskRepo.findOne({ where: {} });
    if (risk) {
      setSimInitialCapital(risk, algoKind, amount);
      await riskRepo.save(risk);
    }
  }
}
