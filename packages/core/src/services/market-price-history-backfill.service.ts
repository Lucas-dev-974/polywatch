import pino from 'pino';
import type { DataSource } from 'typeorm';
import type { MarketPriceHistorySync } from '../entities/MarketPriceHistorySync.js';
import {
  fetchPriceHistory,
  DEFAULT_PRICE_HISTORY_FIDELITY,
  MARKET_PRICE_HISTORY_SYNC_INTERVAL_MS,
} from '../polymarket/price-history-client.js';
import { MarketService } from './market.service.js';
import { MarketPriceTickService } from './market-price-tick.service.js';
import { MarketPriceHistorySyncService } from './market-price-history-sync.service.js';

const log = pino({ name: 'market-price-history-backfill' });

export interface EnsureHistorySyncedResult {
  pointCount: number;
  skipped?: 'crypto' | 'no-data';
}

export class MarketPriceHistoryBackfillService {
  private readonly marketService: MarketService;
  private readonly inflight = new Map<
    string,
    Promise<EnsureHistorySyncedResult>
  >();

  constructor(
    private readonly ds: DataSource,
    private readonly tickService: MarketPriceTickService,
    private readonly syncService: MarketPriceHistorySyncService,
  ) {
    this.marketService = new MarketService(ds);
  }

  /**
   * Single entry point for syncing Polymarket price history into local ticks.
   * Handles full bootstrap, incremental sync, and registry reconciliation.
   * Concurrent calls for the same conditionId+assetId share one in-flight promise.
   */
  async ensureHistorySynced(
    conditionId: string,
    assetId: string,
  ): Promise<EnsureHistorySyncedResult> {
    const key = `${conditionId}:${assetId}`;
    const existing = this.inflight.get(key);
    if (existing) return existing;

    const promise = this.doEnsureHistorySynced(conditionId, assetId).finally(
      () => {
        this.inflight.delete(key);
      },
    );
    this.inflight.set(key, promise);
    return promise;
  }

  /** Incremental sync for an existing registry entry (hourly worker cycle). */
  async syncIncrementalEntry(
    syncEntry: MarketPriceHistorySync,
  ): Promise<EnsureHistorySyncedResult> {
    return this.runIncrementalSync(syncEntry);
  }

  private async doEnsureHistorySynced(
    conditionId: string,
    assetId: string,
  ): Promise<EnsureHistorySyncedResult> {
    if (await this.marketService.shouldSkipSync(conditionId)) {
      log.debug({ conditionId, assetId }, 'skipping crypto market history sync');
      return { pointCount: 0, skipped: 'crypto' };
    }

    const endDate = await this.resolveEndDate(conditionId);

    try {
      const syncEntry = await this.syncService.upsert(
        conditionId,
        assetId,
        endDate,
      );

      if (syncEntry.lastPointTs != null) {
        log.info(
          { conditionId, assetId, lastPointTs: syncEntry.lastPointTs },
          'sync entry exists — running incremental sync',
        );
        return await this.runIncrementalSync(syncEntry);
      }

      const latestTickTs = await this.tickService.getLatestTickTs(
        conditionId,
        assetId,
      );
      if (latestTickTs != null) {
        log.info(
          { conditionId, assetId, latestTickTs },
          'reconciling sync registry from existing ticks',
        );
        await this.syncService.updateSyncProgress(
          syncEntry.id,
          latestTickTs,
          new Date(Date.now() + MARKET_PRICE_HISTORY_SYNC_INTERVAL_MS),
        );
        const refreshed = await this.syncService.findByConditionAndAsset(
          conditionId,
          assetId,
        );
        if (refreshed) {
          return await this.runIncrementalSync(refreshed);
        }
        return { pointCount: 0 };
      }

      log.info(
        { conditionId, assetId },
        'bootstrapping price history from Polymarket',
      );
      await this.syncService.updateStatus(syncEntry.id, 'syncing');

      const points = await fetchPriceHistory({
        assetId,
        interval: 'max',
        fidelity: DEFAULT_PRICE_HISTORY_FIDELITY,
      });

      if (points.length === 0) {
        log.warn(
          { conditionId, assetId },
          'no price history returned from Polymarket',
        );
        await this.syncService.updateStatus(
          syncEntry.id,
          'idle',
          'no data returned',
        );
        return { pointCount: 0, skipped: 'no-data' };
      }

      const { attempted } = await this.tickService.upsertBatch(
        conditionId,
        assetId,
        points,
      );
      log.info(
        { conditionId, assetId, total: points.length, attempted },
        'bootstrap complete',
      );

      const lastTs = points[points.length - 1]!.t;
      await this.syncService.updateSyncProgress(
        syncEntry.id,
        lastTs,
        new Date(Date.now() + MARKET_PRICE_HISTORY_SYNC_INTERVAL_MS),
      );

      return { pointCount: points.length };
    } catch (err) {
      log.warn({ err, conditionId, assetId }, 'ensureHistorySynced failed');
      const entry = await this.syncService.findByConditionAndAsset(
        conditionId,
        assetId,
      );
      if (entry) {
        await this.syncService.updateStatus(
          entry.id,
          'error',
          err instanceof Error ? err.message : String(err),
        );
      }
      return { pointCount: 0 };
    }
  }

  private async runIncrementalSync(
    syncEntry: MarketPriceHistorySync,
  ): Promise<EnsureHistorySyncedResult> {
    const { id, assetId, lastPointTs, conditionId } = syncEntry;
    if (lastPointTs == null) {
      return { pointCount: 0 };
    }

    try {
      await this.syncService.updateStatus(id, 'syncing');

      const points = await fetchPriceHistory({
        assetId,
        startTs: lastPointTs,
        endTs: Math.floor(Date.now() / 1000),
        fidelity: DEFAULT_PRICE_HISTORY_FIDELITY,
      });

      if (points.length === 0) {
        await this.syncService.updateSyncProgress(
          id,
          lastPointTs,
          new Date(Date.now() + MARKET_PRICE_HISTORY_SYNC_INTERVAL_MS),
        );
        return { pointCount: 0 };
      }

      const { attempted } = await this.tickService.upsertBatch(
        conditionId,
        assetId,
        points,
      );
      log.info(
        { conditionId, assetId, total: points.length, attempted },
        'incremental sync complete',
      );

      const newLastTs = points[points.length - 1]!.t;
      await this.syncService.updateSyncProgress(
        id,
        Math.max(lastPointTs, newLastTs),
        new Date(Date.now() + MARKET_PRICE_HISTORY_SYNC_INTERVAL_MS),
      );

      return { pointCount: points.length };
    } catch (err) {
      log.warn({ err, conditionId, assetId }, 'incremental sync failed');
      await this.syncService.updateStatus(
        id,
        'error',
        err instanceof Error ? err.message : String(err),
      );
      return { pointCount: 0 };
    }
  }

  private async resolveEndDate(conditionId: string): Promise<Date | null> {
    try {
      const markets = await this.marketService.loadByConditionIds([
        conditionId,
      ]);
      const market = markets.get(conditionId);
      if (!market?.endDate) return null;
      return new Date(market.endDate);
    } catch {
      return null;
    }
  }
}
