import type { DataSource } from 'typeorm';
import { In } from 'typeorm';
import { CopiedPosition } from '../entities/CopiedPosition.js';
import { Execution } from '../entities/Execution.js';
import { PositionReservation } from '../entities/PositionReservation.js';
import type { ExecutionResult, OrderReason } from '../types/index.js';
import {
  computeBuyCashDebit,
  computeSellSettlement,
} from '../simulation/accounting.js';
import { algoKindFromReason } from '../simulation/algo-kind.js';
import { MIN_ORDER_SHARES } from '../sizing/constants.js';
import { computePositionUnrealizedPnl } from '../positions/mark.js';
import {
  isForcedExitCloseReason,
  isForcedExitRetryableError,
} from '../orders/forced-exit.js';
import { RESERVATION_CLOSE_REASON_RELEASED } from '../positions/reservation-close-reasons.js';
import { SimulationService } from './simulation.service.js';
import { ExitAttemptEventService } from './exit-attempt-event.service.js';

// PostgreSQL always supports pessimistic locking — this helper is kept for clarity.
const supportsPessimisticLock = (_ds: DataSource): boolean => true;

const OPTIMISTIC_LOCK_ERROR = 'OptimisticLockVersionMismatchError';
const ACTIVE_SELL_STATUSES = ['placing', 'live_on_clob', 'partial'] as const;
/** After this age, a real/sim REDEMPTION stuck in `placing` may be retried. */
export const REDEMPTION_PLACING_TIMEOUT_MS = 5 * 60_000;
/** Sim BUY still pending+placing longer than this → orphan (fail-fast via PlacingJanitor). */
export const SIM_BUY_PLACING_STALE_MS = 60_000;

function syncPersistedUnrealizedPnl(pos: CopiedPosition): void {
  if (pos.status !== 'open' || pos.quantity <= 0) {
    if (pos.status === 'closed' || pos.quantity <= 0) {
      pos.unrealizedPnl = 0;
    }
    return;
  }
  pos.unrealizedPnl = computePositionUnrealizedPnl(pos);
}

/**
 * Validate that bid-points thresholds are positive when set.
 * Returns true if thresholds are valid (null or > 0).
 *
 * Exported for unit testing — not part of the public service API.
 */
export function validateBidPointsThresholds(pos: CopiedPosition): boolean {
  if (pos.slBidPoints != null && pos.slBidPoints <= 0) return false;
  if (pos.tpBidPoints != null && pos.tpBidPoints <= 0) return false;
  return true;
}

export interface ClaimInput {
  orderSignalId: string;
  copiedPositionId: number;
  mode: 'sim' | 'real';
  side: 'BUY' | 'SELL';
  reason: OrderReason;
  requestedQty?: number;
  orderType?: string;
  referenceVwap?: number;
}

export interface ClaimResult {
  execution: Execution;
  /** True when the signal was already claimed and is still in flight on the CLOB. */
  alreadyInFlight: boolean;
}

export interface FinalizeInput {
  orderSignalId: string;
  status: 'filled' | 'partial' | 'cancelled' | 'failed' | 'no_payout';
  fillPrice: number;
  fillQuantity: number;
  fees: number;
  entryBidVwap?: number;
  txHash?: string;
  clobOrderId?: string;
  error?: string;
  /** Match/fill instant from executor; defaults to finalize time when omitted. */
  executedAt?: Date;
  /** VWAP reference captured when the signal was generated — used for slippage reporting. */
  referenceVwap?: number;
  /** Detected slippage percent at guard/execution time. */
  slippagePercent?: number;
}

export class ExecutionService {
  private simulationService: SimulationService;

  constructor(private readonly ds: DataSource) {
    this.simulationService = new SimulationService(ds);
  }

  async claimUnlessFilled(input: ClaimInput): Promise<boolean> {
    const repo = this.ds.getRepository(Execution);
    const existing = await repo.findOne({
      where: { orderSignalId: input.orderSignalId },
    });

    if (existing) {
      if (existing.status === 'filled' || existing.status === 'no_payout') {
        return false;
      }
      if (existing.status === 'placing' || existing.status === 'live_on_clob') {
        // REDEMPTION already submitted — wait for ResultsConsumer to finalize
        // instead of posting a second on-chain redeem. Timed-out placing rows
        // are reset to failed so the next poll can reclaim (no CLOB order id).
        if (input.reason === 'REDEMPTION') {
          const startedAt = existing.executedAt?.getTime();
          const timedOut =
            startedAt != null &&
            Date.now() - startedAt > REDEMPTION_PLACING_TIMEOUT_MS;
          if (timedOut) {
            existing.status = 'failed';
            existing.error = 'redemption_placing_timeout';
            await repo.save(existing);
          } else {
            if (startedAt == null) {
              existing.executedAt = new Date();
              await repo.save(existing);
            }
            return false;
          }
        } else {
          return true;
        }
      }
      if (existing.status === 'failed' && input.reason === 'REDEMPTION') {
        existing.status = 'placing';
        existing.error = null;
        existing.executedAt = new Date();
        await repo.save(existing);
        return true;
      }
      throw new Error('already_claimed');
    }

    await this.claim(input);
    return true;
  }

  /**
   * Sim executions stuck in `placing` after their position left the expected state,
   * or BUY entries still `pending` with a stale/missing/expired reservation.
   */
  async loadOrphanPlacingSim(): Promise<Execution[]> {
    const now = new Date();
    const staleBefore = new Date(now.getTime() - SIM_BUY_PLACING_STALE_MS);

    return this.ds
      .getRepository(Execution)
      .createQueryBuilder('e')
      .leftJoin(CopiedPosition, 'p', 'p.id = e.copied_position_id')
      .leftJoin(
        PositionReservation,
        'r',
        'r.order_signal_id = e.order_signal_id',
      )
      .where('e.mode = :mode', { mode: 'sim' })
      .andWhere('e.status = :status', { status: 'placing' })
      .andWhere(
        `(
          p.id IS NULL
          OR (
            e.side = 'BUY'
            AND p.status != 'pending'
          )
          OR (
            e.side = 'BUY'
            AND p.status = 'pending'
            AND (
              r.id IS NULL
              OR r.created_at < :staleBefore
              OR r.expires_at < :now
            )
          )
          OR (
            e.reason = 'REDEMPTION'
            AND p.status != 'pending_resolution'
          )
          OR (
            e.side = 'SELL'
            AND (e.reason IS NULL OR e.reason != 'REDEMPTION')
            AND p.status != 'closing'
          )
        )`,
        { staleBefore, now },
      )
      .getMany();
  }

  async loadPlacingReal(): Promise<Execution[]> {
    return this.ds.getRepository(Execution).find({
      where: { mode: 'real', status: 'placing' },
    });
  }

  /** Cancel in-flight executions before forcing a stuck position to failed. */
  async failActiveForPosition(copiedPositionId: number): Promise<number> {
    const result = await this.ds
      .getRepository(Execution)
      .createQueryBuilder()
      .update(Execution)
      .set({ status: 'failed', error: 'watchdog_cancelled' })
      .where('copied_position_id = :id', { id: copiedPositionId })
      .andWhere('status IN (:...statuses)', {
        statuses: ['placing', 'live_on_clob', 'partial'],
      })
      .execute();
    return result.affected ?? 0;
  }

  /** True when a BUY execution is in flight (placing, live_on_clob, or partial) for the given position. */
  async hasInFlightBuy(copiedPositionId: number): Promise<boolean> {
    const count = await this.ds
      .getRepository(Execution)
      .count({
        where: {
          copiedPositionId,
          side: 'BUY',
          status: In(['placing', 'live_on_clob', 'partial']),
        },
      });
    return count > 0;
  }

  /**
   * BUY notional still committed on the CLOB for entries whose reservation
   * row was already cleared (e.g. after a partial fill).
   */
  async sumInFlightBuyNotionalWithoutReservation(mode: 'real' | 'sim'): Promise<number> {
    const rows = await this.ds
      .getRepository(Execution)
      .createQueryBuilder('e')
      .leftJoin(
        PositionReservation,
        'r',
        'r.order_signal_id = e.order_signal_id',
      )
      .where('e.mode = :mode', { mode })
      .andWhere('e.side = :side', { side: 'BUY' })
      .andWhere('e.status IN (:...statuses)', {
        statuses: ['placing', 'live_on_clob', 'partial'],
      })
      .andWhere('r.id IS NULL')
      .getMany();

    let total = 0;
    for (const exec of rows) {
      const requested = exec.requestedQty ?? 0;
      const filled = exec.fillQuantity ?? 0;
      const remaining = Math.max(0, requested - filled);
      const price = exec.referenceVwap ?? exec.fillPrice ?? 0;
      total += remaining * price;
    }
    return total;
  }

  async findCopiedPositionId(orderSignalId: string): Promise<number | null> {
    const exec = await this.findByOrderSignalId(orderSignalId);
    return exec?.copiedPositionId ?? null;
  }

  async hasBuyForPosition(copiedPositionId: number): Promise<boolean> {
    const count = await this.ds.getRepository(Execution).count({
      where: { copiedPositionId, side: 'BUY' },
    });
    return count > 0;
  }

  async findByOrderSignalId(orderSignalId: string): Promise<Execution | null> {
    return this.ds.getRepository(Execution).findOne({
      where: { orderSignalId },
    });
  }

  /** Real executions that may still receive a CLOB fill (placing, partial, or failed-without-fill). */
  async loadReconcilableReal(): Promise<Execution[]> {
    const repo = this.ds.getRepository(Execution);
    const placing = await repo.find({
      where: { mode: 'real', status: In(['placing', 'live_on_clob', 'partial']) },
    });
    const failed = await repo
      .createQueryBuilder('e')
      .where('e.mode = :mode', { mode: 'real' })
      .andWhere('e.status = :status', { status: 'failed' })
      .andWhere('e.clob_order_id IS NOT NULL')
      .andWhere('(e.fill_quantity IS NULL OR e.fill_quantity = 0)')
      .getMany();
    return [...placing, ...failed];
  }

  async recordPlacingClobOrderId(
    orderSignalId: string,
    clobOrderId: string,
  ): Promise<void> {
    const repo = this.ds.getRepository(Execution);
    const exec = await repo.findOne({
      where: { orderSignalId, status: 'placing' },
    });
    if (!exec || exec.clobOrderId) return;
    exec.clobOrderId = clobOrderId;
    await repo.save(exec);
  }

  async findPlacingRealByClobOrderId(
    clobOrderId: string,
  ): Promise<Execution | null> {
    return this.findReconcilableRealByClobOrderId(clobOrderId);
  }

  async findReconcilableRealByClobOrderId(
    clobOrderId: string,
  ): Promise<Execution | null> {
    const exec = await this.ds.getRepository(Execution).findOne({
      where: { mode: 'real', clobOrderId },
    });
    if (!exec) return null;
    if (
      exec.status === 'placing' ||
      exec.status === 'live_on_clob' ||
      exec.status === 'partial'
    ) {
      return exec;
    }
    if (exec.status === 'failed' && (exec.fillQuantity ?? 0) <= 0) {
      return exec;
    }
    return null;
  }

  async claim(input: ClaimInput): Promise<ClaimResult> {
    return this.ds.transaction(async (manager) => {
      const repo = manager.getRepository(Execution);
      const posRepo = manager.getRepository(CopiedPosition);

      const existing = await repo.findOne({
        where: { orderSignalId: input.orderSignalId },
      });
      if (existing) {
        if (existing.status === 'placing' || existing.status === 'live_on_clob') {
          return { execution: existing, alreadyInFlight: true };
        }
        throw new Error('already_claimed');
      }

      if (input.side === 'SELL') {
        const pos = await posRepo.findOne({ where: { id: input.copiedPositionId } });
        if (
          !pos ||
          pos.status === 'closed' ||
          pos.status === 'cancelled' ||
          pos.quantity <= 0
        ) {
          throw new Error('already_claimed');
        }

        const activeSell = await repo.findOne({
          where: {
            copiedPositionId: input.copiedPositionId,
            side: 'SELL',
            status: In([...ACTIVE_SELL_STATUSES]),
          },
        });
        if (activeSell) {
          throw new Error('already_claimed');
        }
      }

      const saved = await repo.save(
        repo.create({
          orderSignalId: input.orderSignalId,
          copiedPositionId: input.copiedPositionId,
          mode: input.mode,
          side: input.side,
          reason: input.reason,
          requestedQty: input.requestedQty ?? null,
          orderType: input.orderType ?? 'FAK',
          referenceVwap: input.referenceVwap ?? null,
          status: 'placing',
          // REDEMPTION has no CLOB order — stamp attempt start for placing timeout.
          executedAt: input.reason === 'REDEMPTION' ? new Date() : null,
        }),
      );
      return { execution: saved, alreadyInFlight: false };
    });
  }

  async finalize(input: FinalizeInput): Promise<CopiedPosition | null> {
    const lock = supportsPessimisticLock(this.ds);
    try {
      return await this.finalizeWithLock(input, lock);
    } catch (err) {
      if (
        err &&
        typeof err === 'object' &&
        'name' in err &&
        (err as Error).name === OPTIMISTIC_LOCK_ERROR
      ) {
        // Another process already finalised this execution — return idempotently.
        // Fetch by orderSignalId because TypeORM's error does not expose entityId.
        const exec = await this.ds.getRepository(Execution).findOne({
          where: { orderSignalId: input.orderSignalId },
        });
        if (!exec) return null;
        return this.ds.getRepository(CopiedPosition).findOne({
          where: { id: exec.copiedPositionId },
        });
      }
      throw err;
    }
  }

  private async finalizeWithLock(
    input: FinalizeInput,
    lock: boolean,
  ): Promise<CopiedPosition | null> {
    return this.ds.transaction(async (manager) => {
      const execRepo = manager.getRepository(Execution);
      const posRepo = manager.getRepository(CopiedPosition);
      const resRepo = manager.getRepository(PositionReservation);

      const execQuery = execRepo
        .createQueryBuilder('e')
        .where('e.orderSignalId = :orderSignalId', {
          orderSignalId: input.orderSignalId,
        });
      const exec = await (lock ? execQuery.setLock('pessimistic_write') : execQuery).getOne();
      if (!exec) throw new Error('execution_not_found');

      const posQuery = posRepo
        .createQueryBuilder('p')
        .where('p.id = :id', { id: exec.copiedPositionId });
      const pos = await (lock ? posQuery.setLock('pessimistic_write') : posQuery).getOne();
      if (!pos) throw new Error('position_not_found');

      const now = new Date();
      const eventAt = input.executedAt ?? now;
      const isBuy = exec.side === 'BUY';
      const reason = exec.reason ?? '';

      if (input.status === 'failed' || input.status === 'cancelled') {
        if (exec.status === 'failed' || exec.status === 'cancelled') {
          return pos;
        }
        exec.status = input.status;
        exec.error = input.error ?? null;
        if (input.referenceVwap != null) exec.referenceVwap = input.referenceVwap;
        if (input.slippagePercent != null) exec.slippagePercent = input.slippagePercent;
        await execRepo.save(exec);
        if (isBuy && pos.status === 'pending') {
          pos.status = 'cancelled';
          // A failed BUY execution cancels the pending position — record the
          // close reason so audit queries can attribute cancellations instead
          // of leaving close_reason NULL (which made 20 rows un-attributable).
          if (!pos.closeReason) {
            pos.closeReason = RESERVATION_CLOSE_REASON_RELEASED;
          }
          await posRepo.save(pos);
          await resRepo.delete({ orderSignalId: input.orderSignalId });
        } else if (!isBuy && pos.status === 'closing') {
          pos.status = 'open';
          pos.closingStartedAt = null;
          if (
            isForcedExitCloseReason(reason) &&
            isForcedExitRetryableError(input.error ?? undefined)
          ) {
            pos.forcedExitFailedAttempts =
              (pos.forcedExitFailedAttempts ?? 0) + 1;
            pos.lastForcedExitAttemptAt = now;
            await new ExitAttemptEventService(this.ds).record(
              {
                copiedPositionId: pos.id,
                mode: pos.mode,
                kind: 'execution_failed',
                closeReason: reason,
                error: input.error ?? null,
                executionId: exec.id,
                markBid: exec.referenceVwap,
                createdAt: now,
              },
              manager,
            );
          }
          await posRepo.save(pos);
        }
        return pos;
      }

      const execStatus = exec.status;
      if (execStatus === 'filled' || execStatus === 'no_payout') {
        return pos;
      }
      if (execStatus === 'failed' || execStatus === 'cancelled') {
        const lateRealFill =
          exec.mode === 'real' &&
          input.fillQuantity > 0 &&
          (input.status === 'filled' || input.status === 'partial');
        if (!lateRealFill) {
          return pos;
        }
        if (isBuy && pos.status === 'cancelled') {
          pos.status = 'pending';
        }
        exec.status = 'placing';
        exec.error = null;
      }

      const prevFillQty = exec.fillQuantity ?? 0;
      let fillDelta = isBuy
        ? input.fillQuantity
        : Math.min(input.fillQuantity, pos.quantity);
      if (
        !isBuy &&
        exec.requestedQty != null &&
        exec.requestedQty > 0
      ) {
        const maxDelta = Math.max(0, exec.requestedQty - prevFillQty);
        fillDelta = Math.min(fillDelta, maxDelta);
      }
      const newFillQty = prevFillQty + fillDelta;
      const prevFees = exec.fees ?? 0;
      const prevFillPrice = exec.fillPrice ?? 0;

      if (isBuy) {
        if (pos.status !== 'pending' && pos.status !== 'open') {
          exec.status = 'failed';
          exec.error = 'invalid_buy_state';
          await execRepo.save(exec);
          return pos;
        }
      } else if (
        pos.status === 'closed' ||
        pos.status === 'cancelled' ||
        pos.quantity <= 0
      ) {
        exec.status = 'failed';
        exec.error = 'position_already_closed';
        await execRepo.save(exec);
        return pos;
      } else {
        const sellQty = Math.min(input.fillQuantity, pos.quantity);
        if (sellQty <= 0) {
          exec.status = 'failed';
          exec.error = 'nothing_to_sell';
          await execRepo.save(exec);
          return pos;
        }
      }

      exec.fillPrice =
        prevFillQty > 0
          ? (prevFillPrice * prevFillQty + input.fillPrice * fillDelta) / newFillQty
          : input.fillPrice;
      exec.fillQuantity =
        !isBuy && exec.requestedQty != null && exec.requestedQty > 0
          ? Math.min(newFillQty, exec.requestedQty)
          : newFillQty;
      exec.fees = prevFees + input.fees;
      exec.txHash = input.txHash ?? exec.txHash;
      exec.clobOrderId = input.clobOrderId ?? exec.clobOrderId;
      exec.executedAt = eventAt;
      if (input.referenceVwap != null) exec.referenceVwap = input.referenceVwap;
      if (input.slippagePercent != null) exec.slippagePercent = input.slippagePercent;
      exec.status =
        input.status === 'partial'
          ? 'partial'
          : input.status === 'no_payout'
            ? 'no_payout'
            : 'filled';

      if (isBuy) {
        if (pos.status === 'pending') {
          pos.status = 'open';
          pos.quantity = newFillQty;
          pos.entryPrice = input.fillPrice;
          pos.entryBidVwap = input.entryBidVwap ?? input.fillPrice;
          pos.entryQuantityRemaining = newFillQty;
          pos.entryFees = exec.fees;
          pos.entryFeesRemaining = exec.fees;
          pos.openedAt = eventAt;
        } else if (pos.status === 'open') {
          const oldQty = pos.quantity;
          const delta = input.fillQuantity;
          pos.entryPrice =
            (oldQty * pos.entryPrice + delta * input.fillPrice) /
            (oldQty + delta);
          const entryBidMark = input.entryBidVwap ?? input.fillPrice;
          pos.entryBidVwap =
            (oldQty * pos.entryBidVwap + delta * entryBidMark) / (oldQty + delta);
          pos.quantity = oldQty + delta;
          pos.entryQuantityRemaining = pos.quantity;
          pos.entryFees += input.fees;
          pos.entryFeesRemaining += input.fees;
          if (reason === 'COPY_INCREASE') {
            pos.increaseCount = (pos.increaseCount ?? 0) + 1;
          }
        }
        await resRepo.delete({ orderSignalId: input.orderSignalId });

        if (pos.mode === 'sim') {
          await this.simulationService.adjustCash(
            -computeBuyCashDebit(
              input.fillPrice,
              input.fillQuantity,
              input.fees,
            ),
            algoKindFromReason(pos.reason),
            manager,
          );
        }
      } else {
        const sellQty = Math.min(input.fillQuantity, pos.quantity);
        const sellFees =
          input.fillQuantity > 0
            ? input.fees * (sellQty / input.fillQuantity)
            : 0;
        const isRedemption = reason === 'REDEMPTION';
        const qtyRemaining = pos.entryQuantityRemaining ?? pos.quantity;
        const settlement = computeSellSettlement({
          isRedemption,
          fillPrice: input.fillPrice,
          fillQuantity: sellQty,
          inputFees: sellFees,
          entryPrice: pos.entryPrice,
          entryFeesRemaining: pos.entryFeesRemaining,
          entryQuantityRemaining: qtyRemaining,
        });

        exec.realizedPnl = (exec.realizedPnl ?? 0) + settlement.realizedPnl;
        pos.realizedPnl += settlement.realizedPnl;
        pos.entryFeesRemaining -= settlement.feeAlloc;
        pos.entryQuantityRemaining = Math.max(0, qtyRemaining - sellQty);
        pos.quantity -= sellQty;

        if (isForcedExitCloseReason(reason) && fillDelta > 0) {
          pos.forcedExitFailedAttempts = 0;
          pos.lastForcedExitAttemptAt = null;
          pos.lastExitBlockReason = null;
          pos.lastExitBlockCloseReason = null;
          pos.firstExitBlockAt = null;
          pos.lastExitBlockAt = null;
          pos.exitEmitBlockedCount = 0;
        }

        if (isRedemption || pos.quantity < MIN_ORDER_SHARES) {
          pos.status = 'closed';
          pos.closedAt = eventAt;
          pos.closeReason = reason || null;
          pos.closingReason = null;
          pos.quantity = 0;
          pos.lastExitBlockReason = null;
          pos.lastExitBlockCloseReason = null;
          pos.firstExitBlockAt = null;
          pos.lastExitBlockAt = null;
          pos.exitEmitBlockedCount = 0;
        } else if (pos.status === 'closing') {
          pos.status = 'open';
          pos.closingStartedAt = null;
          pos.closingReason = null;
        }

        if (pos.mode === 'sim') {
          await this.simulationService.adjustCash(settlement.cashCredit, algoKindFromReason(pos.reason), manager);
        }
      }

      syncPersistedUnrealizedPnl(pos);

      await execRepo.save(exec);
      await posRepo.save(pos);
      return pos;
    });
  }

  toExecutionResult(exec: Execution): ExecutionResult {
    return {
      orderSignalId: exec.orderSignalId,
      mode: exec.mode as 'sim' | 'real',
      status:
        exec.status === 'partial'
          ? 'partial'
          : exec.status === 'filled'
            ? 'filled'
            : exec.status === 'no_payout'
              ? 'no_payout'
              : exec.status === 'cancelled'
                ? 'cancelled'
                : 'failed',
      fillPrice: exec.fillPrice ?? 0,
      fillQuantity: exec.fillQuantity ?? 0,
      fees: exec.fees,
      referenceVwap: exec.referenceVwap ?? undefined,
      slippagePercent: exec.slippagePercent ?? undefined,
      txHash: exec.txHash ?? undefined,
      clobOrderId: exec.clobOrderId ?? undefined,
      error: exec.error ?? undefined,
      executedAt: exec.executedAt ?? new Date(),
    };
  }
}
