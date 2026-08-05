import type { DataSource, SelectQueryBuilder } from 'typeorm';
import { In } from 'typeorm';
import { MoveEventEntity } from '../entities/MoveEvent.js';
import { CopiedPosition } from '../entities/CopiedPosition.js';
import { Execution } from '../entities/Execution.js';
import { WatchlistEntry } from '../entities/Watchlist.js';
import { MarketService } from './market.service.js';
import { watchlistTraderDisplayName } from './copied-position-presenter.js';
import {
  ALWAYS_SHOWN_MOVE_EVENT_TYPES,
  OPEN_COPIED_POSITION_EXISTS_SQL,
} from '../move-events/relevance.js';

export interface EnrichedMoveEvent extends MoveEventEntity {
  traderName: string;
  marketTitle: string | null;
  marketUrl: string | null;
  executedSim: boolean;
  executedReal: boolean;
  copySlippage: number | null;
  skipReasonsSim: string | null;
  skipReasonsReal: string | null;
  executionErrorSim: string | null;
  executionErrorReal: string | null;
}

export interface MoveSkipReasonsUpdate {
  sim?: string;
  real?: string;
}

export class MoveEventService {
  constructor(private readonly ds: DataSource) {}

  private applyRelevantFilter(qb: SelectQueryBuilder<MoveEventEntity>): void {
    qb.andWhere(
      `(
        m.event_type IN (:...alwaysShownTypes)
        OR ${OPEN_COPIED_POSITION_EXISTS_SQL}
      )`,
      { alwaysShownTypes: ALWAYS_SHOWN_MOVE_EVENT_TYPES },
    );
  }
  async loadRecent(options: {
    limit: number;
    offset?: number;
    mode?: 'sim' | 'real';
    processed?: boolean;
  }): Promise<{ items: EnrichedMoveEvent[]; total: number }> {
    const buildQb = (forCount = false) => {
      const qb = this.ds
        .getRepository(MoveEventEntity)
        .createQueryBuilder('m');
      this.applyRelevantFilter(qb);
      this.applyProcessedFilter(qb, options.processed);
      this.applyModeFilter(qb, options.mode);
      if (!forCount) {
        qb.orderBy('m.detectedAt', 'DESC').skip(options.offset ?? 0).take(options.limit);
      }
      return qb;
    };

    const listQb = buildQb();
    const countQb = buildQb(true);

    const [rawItems, total] = await Promise.all([
      listQb.getMany(),
      countQb.getCount(),
    ]);
    const items = await this.enrich(rawItems);
    return { items, total };
  }

  private applyProcessedFilter(
    qb: SelectQueryBuilder<MoveEventEntity>,
    processed: boolean | undefined,
  ): void {
    if (processed === undefined) return;
    qb.andWhere('m.processed = :processed', { processed });
  }

  private applyModeFilter(
    qb: SelectQueryBuilder<MoveEventEntity>,
    mode: 'sim' | 'real' | undefined,
  ): void {
    if (!mode) return;
    qb.andWhere(
      `EXISTS (
        SELECT 1 FROM copied_positions p
        WHERE p.move_event_id = m.id
        AND p.mode = :mode
      )`,
      { mode },
    );
  }

  private async enrich(
    events: MoveEventEntity[],
  ): Promise<EnrichedMoveEvent[]> {
    if (events.length === 0) return [];

    const traderAddresses = [...new Set(events.map((e) => e.traderAddress))];
    const conditionIds = [...new Set(events.map((e) => e.conditionId))];
    const moveIds = events.map((e) => e.id);

    const [watchlistEntries, marketsByCondition, copyStats] = await Promise.all([
      this.ds
        .getRepository(WatchlistEntry)
        .createQueryBuilder('w')
        .where('w.trader_address IN (:...addresses)', { addresses: traderAddresses })
        .getMany(),
      new MarketService(this.ds).resolveMany(conditionIds),
      this.loadCopyStats(moveIds),
    ]);

    const watchlistByAddress = new Map(
      watchlistEntries.map((w) => [w.traderAddress.toLowerCase(), w]),
    );

    return events.map((event) => {
      const watchlist = watchlistByAddress.get(event.traderAddress.toLowerCase());
      const market = marketsByCondition.get(event.conditionId);
      const stats = copyStats.get(event.id);
      return {
        ...event,
        traderName: watchlistTraderDisplayName(watchlist) ?? `${event.traderAddress.slice(0, 8)}…`,
        marketTitle: market?.question ?? null,
        marketUrl: market?.url ?? null,
        executedSim: stats?.executedSim ?? false,
        executedReal: stats?.executedReal ?? false,
        copySlippage: stats?.slippage ?? null,
        skipReasonsSim: event.skipReasons?.sim ?? null,
        skipReasonsReal: event.skipReasons?.real ?? null,
        executionErrorSim: stats?.executionErrorSim ?? null,
        executionErrorReal: stats?.executionErrorReal ?? null,
      };
    });
  }

  private async loadCopyStats(
    moveIds: string[],
  ): Promise<
    Map<
      string,
      {
        executedSim: boolean;
        executedReal: boolean;
        slippage: number | null;
        executionErrorSim: string | null;
        executionErrorReal: string | null;
      }
    >
  > {
    const result = new Map<
      string,
      {
        executedSim: boolean;
        executedReal: boolean;
        slippage: number | null;
        executionErrorSim: string | null;
        executionErrorReal: string | null;
      }
    >();
    if (moveIds.length === 0) return result;

    const positions = await this.ds
      .getRepository(CopiedPosition)
      .createQueryBuilder('p')
      .where('p.move_event_id IN (:...ids)', { ids: moveIds })
      .getMany();

    if (positions.length === 0) {
      for (const id of moveIds) {
        result.set(id, {
          executedSim: false,
          executedReal: false,
          slippage: null,
          executionErrorSim: null,
          executionErrorReal: null,
        });
      }
      return result;
    }

    const positionIds = positions.map((p) => p.id);
    const executions = await this.ds
      .getRepository(Execution)
      .find({
        where: { copiedPositionId: In(positionIds) },
        order: { id: 'ASC' },
      });

    const executionsByMove = new Map<string, Execution[]>();
    for (const exec of executions) {
      const pos = positions.find((p) => p.id === exec.copiedPositionId);
      if (!pos?.moveEventId) continue;
      const list = executionsByMove.get(pos.moveEventId);
      if (list) list.push(exec);
      else executionsByMove.set(pos.moveEventId, [exec]);
    }

    for (const id of moveIds) {
      const execList = executionsByMove.get(id) ?? [];
      const buyExecs = execList.filter((e) => e.side === 'BUY');
      result.set(id, {
        executedSim: buyExecs.some(
          (e) =>
            e.mode === 'sim' &&
            (e.status === 'filled' || e.status === 'partial') &&
            (e.fillQuantity ?? 0) > 0,
        ),
        executedReal: buyExecs.some(
          (e) =>
            e.mode === 'real' &&
            (e.status === 'filled' || e.status === 'partial') &&
            (e.fillQuantity ?? 0) > 0,
        ),
        slippage: computeAverageSlippage(execList),
        executionErrorSim:
          buyExecs.find((e) => e.mode === 'sim' && e.status === 'failed')?.error ??
          null,
        executionErrorReal:
          buyExecs.find((e) => e.mode === 'real' && e.status === 'failed')?.error ??
          null,
      });
    }

    return result;
  }

  async markProcessed(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.ds.getRepository(MoveEventEntity).update(
      { id: In(ids) },
      { processed: true },
    );
  }

  async findById(id: string): Promise<MoveEventEntity | null> {
    return this.ds.getRepository(MoveEventEntity).findOne({ where: { id } });
  }

  async markProcessedWithReasons(
    ids: string[],
    reasons: MoveSkipReasonsUpdate,
  ): Promise<void> {
    if (ids.length === 0) return;
    await this.ds.getRepository(MoveEventEntity).update(
      { id: In(ids) },
      {
        processed: true,
        skipReasons: Object.keys(reasons).length > 0 ? reasons : null,
      },
    );
  }

  async loadUnprocessed(): Promise<MoveEventEntity[]> {
    return this.ds.getRepository(MoveEventEntity).find({
      where: { processed: false },
      order: { detectedAt: 'ASC' },
    });
  }

  /**
   * Load move events that are marked processed but whose associated copied
   * position is still `pending` with no active reservation. This indicates a
   * crash after reservation + markProcessed but before the BUY execution was
   * finalized. These moves should be retried.
   */
  async loadProcessedWithStalePending(): Promise<MoveEventEntity[]> {
    const now = new Date();
    const moves = await this.ds
      .getRepository(MoveEventEntity)
      .createQueryBuilder('m')
      .where('m.processed = :processed', { processed: true })
      .andWhere(
        `EXISTS (
          SELECT 1 FROM copied_positions p
          WHERE p.move_event_id = m.id
          AND p.status = 'pending'
          AND NOT EXISTS (
            SELECT 1 FROM position_reservations r
            WHERE r.copied_position_id = p.id
            AND r.expires_at >= :now
          )
        )`,
        { now },
      )
      .getMany();
    return moves;
  }

  /** Reset processed flag so the move event is retried on the next poll cycle.
   * Preserves skipReasons (e.g. `session_reset`) so sim stays gated after recovery. */
  async resetProcessed(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.ds.getRepository(MoveEventEntity).update(
      { id: In(ids) },
      { processed: false },
    );
  }

  /**
   * Backfill avgPrice for recent OPENED events that have no avgPrice.
   * This happens when the Data API doesn't return avgPrice for newly opened positions.
   * We use the trader snapshot's avgPrice from the next poll cycle to fill the gap.
   *
   * @param traderAddress - The trader whose OPENED events to backfill
   * @param snapshots - Current position snapshots with consolidated avgPrice
   * @param maxAgeMs - Only backfill events detected within this window (default: 5 minutes)
   * @returns Number of events updated
   */
  async backfillRecentAvgPrice(
    traderAddress: string,
    snapshots: { conditionId: string; assetId: string; avgPrice?: number | null }[],
    maxAgeMs = 5 * 60_000,
  ): Promise<number> {
    const cutoff = new Date(Date.now() - maxAgeMs);

    // Build a map of conditionId::assetId -> avgPrice from current snapshots
    const avgPriceMap = new Map<string, number>();
    for (const snap of snapshots) {
      if (snap.avgPrice !== null && snap.avgPrice !== undefined && snap.avgPrice > 0) {
        avgPriceMap.set(`${snap.conditionId}::${snap.assetId}`, snap.avgPrice);
      }
    }

    // Find recent OPENED events with no avgPrice (or 0, which means unknown)
    const recentOpenedNoAvg = await this.ds
      .getRepository(MoveEventEntity)
      .createQueryBuilder('m')
      .where('m.trader_address = :traderAddress', { traderAddress: traderAddress.toLowerCase() })
      .andWhere('m.event_type = :eventType', { eventType: 'OPENED' })
      .andWhere('(m.trader_avg_price IS NULL OR m.trader_avg_price = 0)')
      .andWhere('m.detected_at >= :cutoff', { cutoff })
      .getMany();

    if (recentOpenedNoAvg.length === 0) {
      return 0;
    }

    // Update each event with the avgPrice from the snapshot
    let updated = 0;
    for (const event of recentOpenedNoAvg) {
      const key = `${event.conditionId}::${event.assetId}`;
      const avgPrice = avgPriceMap.get(key);
      if (avgPrice !== undefined) {
        event.traderAvgPrice = avgPrice;
        await this.ds.getRepository(MoveEventEntity).save(event);
        updated++;
      }
    }

    return updated;
  }

  async deleteAll(): Promise<number> {
    const result = await this.ds.getRepository(MoveEventEntity).deleteAll();
    return result.affected ?? 0;
  }
}

function computeAverageSlippage(executions: Execution[]): number | null {
  let totalQty = 0;
  let totalSlippage = 0;
  for (const exec of executions) {
    if (
      !exec.referenceVwap ||
      exec.referenceVwap <= 0 ||
      !exec.fillQuantity ||
      exec.fillQuantity <= 0 ||
      !exec.fillPrice ||
      exec.fillPrice <= 0
    ) {
      continue;
    }
    const slippage =
      exec.side === 'SELL'
        ? exec.referenceVwap - exec.fillPrice
        : exec.fillPrice - exec.referenceVwap;
    totalQty += exec.fillQuantity;
    totalSlippage += slippage * exec.fillQuantity;
  }
  if (totalQty <= 0) return null;
  return totalSlippage / totalQty;
}
