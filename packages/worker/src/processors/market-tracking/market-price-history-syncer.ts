import pino from 'pino';
import type { DataSource } from 'typeorm';
import {
  MarketPriceTickService,
  MarketPriceHistorySyncService,
  MarketPriceHistoryBackfillService,
  MarketSyncConfigService,
  fetchPriceHistory,
  MarketService,
} from '@polywatch/core';
import type { OpenPositionTracker } from './open-position-tracker.js';

const log = pino({ name: 'market-price-history-syncer' });

export class MarketPriceHistorySyncer {
  private hourlyTimer: NodeJS.Timeout | null = null;
  private expirationTimer: NodeJS.Timeout | null = null;
  private readonly marketService: MarketService;
  private readonly backfillService: MarketPriceHistoryBackfillService;
  private readonly configService: MarketSyncConfigService;
  private readonly bootstrappedKeys = new Set<string>();

  constructor(
    private readonly ds: DataSource,
    private readonly tickService: MarketPriceTickService,
    private readonly syncService: MarketPriceHistorySyncService,
  ) {
    this.marketService = new MarketService(ds);
    this.configService = new MarketSyncConfigService(ds);
    this.backfillService = new MarketPriceHistoryBackfillService(
      ds,
      tickService,
      syncService,
    );
  }

  async start(): Promise<void> {
    if (this.hourlyTimer) return;
    const config = await this.configService.getConfig();
    log.info(
      {
        maxMarketsPerCycle: config.maxMarketsPerCycle,
        hourlySyncIntervalMs: config.hourlySyncIntervalMs,
        expirationIntervalMs: config.expirationIntervalMs,
        defaultFidelityMinutes: config.defaultFidelityMinutes,
        expirationFidelityMinutes: config.expirationFidelityMinutes,
      },
      'market price history syncer started',
    );
    this.hourlyTimer = setInterval(
      () => void this.runHourlySync(),
      config.hourlySyncIntervalMs,
    );
    this.expirationTimer = setInterval(
      () => void this.runExpirationSync(),
      config.expirationIntervalMs,
    );
  }

  stop(): void {
    if (this.hourlyTimer) {
      clearInterval(this.hourlyTimer);
      this.hourlyTimer = null;
    }
    if (this.expirationTimer) {
      clearInterval(this.expirationTimer);
      this.expirationTimer = null;
    }
    log.info('market price history syncer stopped');
  }

  /**
   * Bootstrap price history for all currently tracked open positions.
   * Skips keys already bootstrapped in this worker session.
   */
  bootstrapTrackedPositions(tracker: OpenPositionTracker): void {
    for (const assetId of tracker.getAllTrackedAssetIds()) {
      const positions = tracker.getPositions(assetId);
      if (positions.length === 0) continue;
      const pos = positions[0]!;
      const key = `${pos.conditionId}:${assetId}`;
      if (this.bootstrappedKeys.has(key)) continue;
      this.bootstrappedKeys.add(key);
      void this.backfillService.ensureHistorySynced(pos.conditionId, assetId);
    }
  }

  private async syncAtExpiration(
    syncEntry: Awaited<
      ReturnType<MarketPriceHistorySyncService['findByConditionAndAsset']>
    >,
  ): Promise<void> {
    if (!syncEntry) return;
    const { id, assetId, lastPointTs, conditionId } = syncEntry;

    try {
      const config = await this.configService.getConfig();
      log.info({ conditionId, assetId }, 'market expired — running final sync');
      await this.syncService.updateStatus(id, 'syncing');

      const points = await fetchPriceHistory({
        assetId,
        startTs: lastPointTs ?? undefined,
        endTs: Math.floor(Date.now() / 1000),
        fidelity: config.expirationFidelityMinutes,
      });

      if (points.length > 0) {
        const { attempted } = await this.tickService.upsertBatch(
          conditionId,
          assetId,
          points,
        );
        log.info(
          { conditionId, assetId, count: points.length, attempted },
          'expiration sync complete',
        );
      }

      await this.syncService.markTerminal(id);
      log.info({ conditionId, assetId }, 'sync marked terminal');
    } catch (err) {
      log.warn({ err, conditionId, assetId }, 'expiration sync failed');
      await this.syncService.updateStatus(
        id,
        'error',
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  private async runHourlySync(): Promise<void> {
    try {
      const config = await this.configService.getConfig();
      const pending = await this.syncService.findPending(
        config.maxMarketsPerCycle,
      );
      if (pending.length === 0) return;

      log.info({ count: pending.length }, 'running hourly sync cycle');

      for (const entry of pending) {
        if (await this.marketService.shouldSkipSync(entry.conditionId)) {
          await this.syncService.updateStatus(entry.id, 'terminal');
          continue;
        }
        await this.backfillService.syncIncrementalEntry(entry);
      }
    } catch (err) {
      log.warn({ err }, 'hourly sync cycle failed');
    }
  }

  private async runExpirationSync(): Promise<void> {
    try {
      const expiring = await this.syncService.findExpiring();
      if (expiring.length === 0) return;

      log.info({ count: expiring.length }, 'running expiration sync');

      for (const entry of expiring) {
        await this.syncAtExpiration(entry);
      }
    } catch (err) {
      log.warn({ err }, 'expiration sync cycle failed');
    }
  }
}
