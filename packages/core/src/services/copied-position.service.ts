import type { DataSource, EntityManager } from 'typeorm';
import { CopiedPosition } from '../entities/CopiedPosition.js';
import { WatchlistEntry } from '../entities/Watchlist.js';
import type { ExitEmitBlockReason } from '../orders/exit-emit-block.js';
import type { TradingMode } from '../types/index.js';
import { MarketService } from './market.service.js';
import { ExitAttemptEventService } from './exit-attempt-event.service.js';

/** Min spacing between DB writes for the same exit-emit block episode. */
export const EXIT_EMIT_BLOCK_RECORD_THROTTLE_MS = 5_000;

export interface BeginCloseResult {
  success: boolean;
  closingAttemptSeq: number;
  resumed: boolean;
}

export interface RecordExitEmitBlockInput {
  blockReason: ExitEmitBlockReason;
  closeReason: string;
  /** Bid mark used for the exit decision (0–1), when known. */
  markBid?: number | null;
  now?: Date;
}

export class CopiedPositionService {
  private marketService: MarketService;

  constructor(private readonly ds: DataSource) {
    this.marketService = new MarketService(ds);
  }

  async beginClose(
    copiedPositionId: number,
    reason: string,
    expectedClosingSeq?: number,
  ): Promise<BeginCloseResult> {
    return this.ds.transaction(async (manager) => {
      const repo = manager.getRepository(CopiedPosition);
      const pos = await repo.findOne({ where: { id: copiedPositionId } });
      if (!pos) return { success: false, closingAttemptSeq: 0, resumed: false };

      if (pos.status === 'open' || pos.status === 'failed') {
        const result = await repo
          .createQueryBuilder()
          .update(CopiedPosition)
          .set({
            status: 'closing',
            closingReason: reason,
            closingAttemptSeq: () => 'closing_attempt_seq + 1',
            closingStartedAt: new Date(),
          })
          .where('id = :id AND status IN (:...statuses)', {
            id: copiedPositionId,
            statuses: ['open', 'failed'],
          })
          .execute();

        if (!result.affected) {
          return {
            success: false,
            closingAttemptSeq: pos.closingAttemptSeq,
            resumed: false,
          };
        }

        const updated = await repo.findOne({ where: { id: copiedPositionId } });
        return {
          success: true,
          closingAttemptSeq: updated!.closingAttemptSeq,
          resumed: false,
        };
      }

      if (
        pos.status === 'closing' &&
        expectedClosingSeq !== undefined &&
        pos.closingAttemptSeq === expectedClosingSeq
      ) {
        return {
          success: true,
          closingAttemptSeq: pos.closingAttemptSeq,
          resumed: true,
        };
      }

      return {
        success: false,
        closingAttemptSeq: pos.closingAttemptSeq,
        resumed: false,
      };
    });
  }

  async markPendingResolution(
    copiedPositionId: number,
    winningTokenId: string,
    conditionId: string,
  ): Promise<CopiedPosition | null> {
    return this.ds.transaction(async (manager) => {
      const posRepo = manager.getRepository(CopiedPosition);

      const pos = await posRepo.findOne({ where: { id: copiedPositionId } });
      if (!pos) return null;

      if (pos.status === 'pending_resolution') return pos;

      if (!['open', 'closing', 'failed'].includes(pos.status)) return null;

      const updated = await posRepo
        .createQueryBuilder()
        .update(CopiedPosition)
        .set({ status: 'pending_resolution' })
        .where('id = :id AND status IN (:...statuses)', {
          id: copiedPositionId,
          statuses: ['open', 'closing', 'failed'],
        })
        .execute();
      if (!updated.affected) return null;

      const refreshed = await posRepo.findOne({ where: { id: copiedPositionId } });
      if (!refreshed) return null;

      await this.marketService.saveResolution(
        conditionId,
        winningTokenId,
        manager,
      );

      return refreshed;
    });
  }

  async loadActive(): Promise<CopiedPosition[]> {
    return this.ds.getRepository(CopiedPosition).find({
      where: [{ status: 'open' }, { status: 'closing' }, { status: 'pending' }],
    });
  }

  async loadPendingResolution(): Promise<CopiedPosition[]> {
    return this.ds.getRepository(CopiedPosition).find({
      where: { status: 'pending_resolution' },
    });
  }

  /** Positions stuck in failed that still hold shares — eligible for redemption cleanup. */
  async loadFailed(): Promise<CopiedPosition[]> {
    return this.ds
      .getRepository(CopiedPosition)
      .createQueryBuilder('p')
      .where('p.status = :status', { status: 'failed' })
      .andWhere('p.quantity > 0')
      .getMany();
  }

  /** Positions still holding shares — eligible for market-resolution detection. */
  async loadResolvable(): Promise<CopiedPosition[]> {
    return this.ds.getRepository(CopiedPosition).find({
      where: [{ status: 'open' }, { status: 'closing' }, { status: 'failed' }],
    });
  }

  /**
   * One-shot backfill for legacy rows that entered `closing` before
   * `closingStartedAt` was introduced. Call once at application startup.
   */
  async backfillClosingStartedAt(): Promise<number> {
    const result = await this.ds
      .getRepository(CopiedPosition)
      .createQueryBuilder()
      .update(CopiedPosition)
      .set({ closingStartedAt: new Date() })
      .where('status = :status', { status: 'closing' })
      .andWhere('closing_started_at IS NULL')
      .execute();
    return result.affected ?? 0;
  }

  async loadClosingStuck(thresholdMinutes: number): Promise<CopiedPosition[]> {
    const threshold = new Date(Date.now() - thresholdMinutes * 60_000);

    return this.ds
      .getRepository(CopiedPosition)
      .createQueryBuilder('p')
      .where('p.status = :status', { status: 'closing' })
      .andWhere('p.closing_started_at < :threshold', { threshold })
      .getMany();
  }

  async markFailed(copiedPositionId: number): Promise<void> {
    await this.ds
      .getRepository(CopiedPosition)
      .createQueryBuilder()
      .update(CopiedPosition)
      .set({ status: 'failed' })
      .where('id = :id AND status = :status', {
        id: copiedPositionId,
        status: 'closing',
      })
      .execute();
  }

  /** Undo a close attempt when the position cannot be sold on the CLOB (e.g. below mos). */
  async revertClose(copiedPositionId: number): Promise<boolean> {
    const result = await this.ds
      .getRepository(CopiedPosition)
      .createQueryBuilder()
      .update(CopiedPosition)
      .set({ status: 'open', closingStartedAt: null, closingReason: null })
      .where('id = :id AND status = :status', {
        id: copiedPositionId,
        status: 'closing',
      })
      .execute();
    return (result.affected ?? 0) > 0;
  }

  /**
   * Positions stuck in `closing` while the CLOB no longer accepts orders.
   * Reverts them to `open` so redemption/resolution can take over without
   * blocking the exit pipeline indefinitely.
   */
  async reconcileClosingOnClosedClob(): Promise<number[]> {
    const positions = await this.ds
      .getRepository(CopiedPosition)
      .createQueryBuilder('p')
      .innerJoin('markets', 'm', 'm.condition_id = p.condition_id')
      .where('p.status = :status', { status: 'closing' })
      .andWhere('m.accepting_orders = false')
      .getMany();

    const revertedIds: number[] = [];
    for (const pos of positions) {
      if (await this.revertClose(pos.id)) {
        revertedIds.push(pos.id);
      }
    }
    return revertedIds;
  }

  async updatePnlFields(
    copiedPositionId: number,
    fields: Partial<
      Pick<
        CopiedPosition,
        | 'executableBidVwap'
        | 'unrealizedPnl'
        | 'peakClosurePnlPercent'
        | 'peakBidVwap'
        | 'liquidityStatus'
        | 'bookUpdatedAt'
        | 'lastCloseableBidVwap'
        | 'lastCloseableBidAt'
      >
    >,
  ): Promise<void> {
    await this.ds.getRepository(CopiedPosition).update(copiedPositionId, fields);
  }

  async updateLastCloseableBid(
    copiedPositionId: number,
    bidVwap: number,
    at: Date = new Date(),
  ): Promise<void> {
    if (bidVwap <= 0) return;
    await this.updatePnlFields(copiedPositionId, {
      lastCloseableBidVwap: bidVwap,
      lastCloseableBidAt: at,
    });
  }

  /**
   * Persist a pre-emit exit block. Throttles count increments (~5s).
   * Starts a new episode (resets firstExitBlockAt) when reason/closeReason change.
   * Appends an exit_attempt_events row in the same transaction as the counter update.
   */
  async recordExitEmitBlock(
    copiedPositionId: number,
    input: RecordExitEmitBlockInput,
  ): Promise<void> {
    const now = input.now ?? new Date();

    await this.ds.transaction(async (manager) => {
      const repo = manager.getRepository(CopiedPosition);
      const pos = await repo.findOne({
        where: { id: copiedPositionId },
        select: {
          id: true,
          mode: true,
          lastExitBlockReason: true,
          lastExitBlockCloseReason: true,
          firstExitBlockAt: true,
          lastExitBlockAt: true,
          exitEmitBlockedCount: true,
        },
      });
      if (!pos) return;

      const sameEpisode =
        pos.lastExitBlockReason === input.blockReason &&
        pos.lastExitBlockCloseReason === input.closeReason &&
        pos.firstExitBlockAt != null;

      if (sameEpisode && pos.lastExitBlockAt != null) {
        const elapsed = now.getTime() - pos.lastExitBlockAt.getTime();
        if (elapsed < EXIT_EMIT_BLOCK_RECORD_THROTTLE_MS) {
          return;
        }
      }

      const firstAt =
        sameEpisode && pos.firstExitBlockAt != null ? pos.firstExitBlockAt : now;

      await repo.update(copiedPositionId, {
        lastExitBlockReason: input.blockReason,
        lastExitBlockCloseReason: input.closeReason,
        firstExitBlockAt: firstAt,
        lastExitBlockAt: now,
        exitEmitBlockedCount: (pos.exitEmitBlockedCount ?? 0) + 1,
      });

      await new ExitAttemptEventService(this.ds).record(
        {
          copiedPositionId,
          mode: pos.mode,
          kind: 'emit_blocked',
          closeReason: input.closeReason,
          blockReason: input.blockReason,
          markBid: input.markBid,
          createdAt: now,
        },
        manager,
      );
    });
  }

  /** Clear pre-emit block episode fields. */
  async clearExitEmitBlock(copiedPositionId: number): Promise<void> {
    await this.ds.getRepository(CopiedPosition).update(copiedPositionId, {
      lastExitBlockReason: null,
      lastExitBlockCloseReason: null,
      firstExitBlockAt: null,
      lastExitBlockAt: null,
      exitEmitBlockedCount: 0,
    });
  }

  async findOpenByMarket(
    watchlistId: number,
    conditionId: string,
    assetId: string,
    mode: TradingMode,
  ): Promise<CopiedPosition | null> {
    return this.ds.getRepository(CopiedPosition).findOne({
      where: { watchlistId, conditionId, assetId, mode, status: 'open' },
    });
  }

  async findPendingEntryForMove(
    watchlistId: number,
    conditionId: string,
    assetId: string,
    mode: TradingMode,
    moveEventId: string,
  ): Promise<CopiedPosition | null> {
    return this.ds.getRepository(CopiedPosition).findOne({
      where: {
        watchlistId,
        conditionId,
        assetId,
        mode,
        status: 'pending',
        moveEventId,
      },
    });
  }

  async hasBlockingActivePosition(
    watchlistId: number,
    conditionId: string,
    assetId: string,
    mode: TradingMode,
    moveEventId: string,
  ): Promise<boolean> {
    const count = await this.ds
      .getRepository(CopiedPosition)
      .createQueryBuilder('p')
      .where('p.watchlist_id = :watchlistId', { watchlistId })
      .andWhere('p.condition_id = :conditionId', { conditionId })
      .andWhere('p.asset_id = :assetId', { assetId })
      .andWhere('p.mode = :mode', { mode })
      .andWhere(
        `(p.status IN ('open', 'closing') OR (p.status = 'pending' AND (p.move_event_id IS NULL OR p.move_event_id != :moveEventId)))`,
        { moveEventId },
      )
      .getCount();
    return count > 0;
  }

  async hasOpenForTraderMarket(
    manager: EntityManager,
    traderAddress: string,
    conditionId: string,
    assetId: string,
  ): Promise<boolean> {
    const count = await manager
      .getRepository(CopiedPosition)
      .createQueryBuilder('p')
      .innerJoin(WatchlistEntry, 'w', 'w.id = p.watchlist_id')
      .where('w.trader_address = :traderAddress', { traderAddress })
      .andWhere('p.condition_id = :conditionId', { conditionId })
      .andWhere('p.asset_id = :assetId', { assetId })
      .andWhere('p.status IN (:...statuses)', {
        statuses: ['open', 'pending', 'closing'],
      })
      .getCount();
    return count > 0;
  }
}
