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

  async getCashAmount(manager?: EntityManager): Promise<number> {
    const repo = (manager ?? this.ds.manager).getRepository(SimulationBalance);
    const balance = await repo.findOne({ where: {} });
    return balance?.amount ?? 0;
  }

  /** Apply a signed cash delta from a finalized execution (sim mode only). */
  async adjustCash(delta: number, manager?: EntityManager): Promise<void> {
    const repo = (manager ?? this.ds.manager).getRepository(SimulationBalance);
    const balance = await repo.findOne({ where: {} });
    if (!balance) return;
    balance.amount = Math.max(0, balance.amount + delta);
    await repo.save(balance);
  }

  private async loadFilledSimExecutions(
    manager: EntityManager,
  ): Promise<SimExecutionCashRow[]> {
    const rows = await manager.getRepository(Execution).find({
      where: { mode: 'sim', status: In([...FILLED_EXEC_STATUSES]) },
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
    return risk?.simInitialCapital ?? DEFAULT_SIM_BALANCE;
  }

  async computeExpectedCash(manager?: EntityManager): Promise<{
    expectedCash: number;
    baselineCapital: number;
    netCashDelta: number;
  }> {
    const m = manager ?? this.ds.manager;
    const balance = await m.getRepository(SimulationBalance).findOne({ where: {} });
    const baselineCapital = balance
      ? await this.resolveBaselineCapital(balance, m)
      : DEFAULT_SIM_BALANCE;
    const netCashDelta = replaySimCashDelta(await this.loadFilledSimExecutions(m));
    return {
      expectedCash: baselineCapital + netCashDelta,
      baselineCapital,
      netCashDelta,
    };
  }

  /**
   * Align stored cash with baseline + replayed execution ledger.
   * Repairs legacy rows missing baseline_capital and corrects drift from bugs.
   */
  async ensureCashIntegrity(manager?: EntityManager): Promise<CashIntegrityResult> {
    const run = async (m: EntityManager): Promise<CashIntegrityResult> => {
      const repo = m.getRepository(SimulationBalance);
      let balance = await repo.findOne({ where: {} });
      if (!balance) {
        const risk = await m.getRepository(RiskConfig).findOne({ where: {} });
        const baseline = risk?.simInitialCapital ?? DEFAULT_SIM_BALANCE;
        balance = await repo.save(
          repo.create({ token: 'pUSD', amount: baseline, baselineCapital: baseline, sessionStartedAt: new Date() }),
        );
        return {
          repaired: false,
          drift: 0,
          expectedCash: baseline,
          baselineCapital: baseline,
        };
      }

      const baselineCapital = await this.resolveBaselineCapital(balance, m);
      if (balance.baselineCapital == null) {
        balance.baselineCapital = baselineCapital;
      }

      const netCashDelta = replaySimCashDelta(await this.loadFilledSimExecutions(m));
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

  async getSnapshot(manager?: EntityManager): Promise<SimulationSnapshot> {
    const m = manager ?? this.ds.manager;
    const balance = await m.getRepository(SimulationBalance).findOne({
      where: {},
    });
    const amount = balance?.amount ?? 0;
    const token = balance?.token ?? 'pUSD';
    const { baselineCapital } = await this.computeExpectedCash(m);

    const openLikePositions = await m.getRepository(CopiedPosition).find({
      where: OPEN_LIKE_POSITION_STATUSES.map((status) => ({
        mode: 'sim' as const,
        status,
      })),
    });

    const closedPositions = await m.getRepository(CopiedPosition).find({
      where: { mode: 'sim', status: 'closed' },
    });

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

  async reset(amount = DEFAULT_SIM_BALANCE): Promise<SimulationSnapshot> {
    await this.ds.transaction(async (manager) => {
      await this.resetWithManager(manager, amount);
    });
    return this.getSnapshot();
  }

  async resetWithManager(
    manager: EntityManager,
    amount = DEFAULT_SIM_BALANCE,
  ): Promise<void> {
    await manager.delete(PositionReservation, { mode: 'sim' });
    await manager.delete(Execution, { mode: 'sim' });
    await manager.delete(CopiedPosition, { mode: 'sim' });

    // Move events are shared between modes, so they cannot be deleted.
    // Marking the still-unprocessed ones as processed prevents the worker's
    // startup orphan recovery from replaying stale (pre-reset) events into
    // the fresh simulation.
    await manager
      .getRepository(MoveEventEntity)
      .update({ processed: false }, { processed: true });

    const repo = manager.getRepository(SimulationBalance);
    const sessionStartedAt = new Date();
    let balance = await repo.findOne({ where: {} });
    if (!balance) {
      balance = repo.create({
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

    // Persist the reset amount as the default for future resets / dialog prefill.
    const riskRepo = manager.getRepository(RiskConfig);
    const risk = await riskRepo.findOne({ where: {} });
    if (risk && risk.simInitialCapital !== amount) {
      risk.simInitialCapital = amount;
      await riskRepo.save(risk);
    }
  }
}
