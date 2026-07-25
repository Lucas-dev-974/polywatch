import type { DataSource } from 'typeorm';
import pino from 'pino';
import {
  AlgoSurveillanceService,
  CLOSE_SNAPSHOT_DELAY_MS,
  OPEN_SNAPSHOT_DELAY_MS,
  SURVEILLANCE_CLOSE_TTL_MS,
  parseUpDownPricesFromGamma,
  resolveUpDownWinnerLabel,
  resolveSurveillanceEndAt,
  snapshotHasRedemptionClose,
  tryRedemptionPricesFromGamma,
  fetchGammaMarket,
  resolveMarketStartDate,
  type GammaMarket,
  type OutcomePrices,
} from '@polywatch/core';
import type { CryptoAlgoPriceFeed } from './price-feed.js';

const log = pino({ name: 'crypto-algo:surveillance-recorder' });

const CLOSE_RESOLUTION_POLL_MS = 3_000;

export interface WatchedMarketInput {
  conditionId: string;
  question?: string | null;
  cryptoSymbol?: string | null;
  interval?: string | null;
  slug?: string | null;
}

export interface SurveillanceRecorderOptions {
  onOpenCaptured?: (conditionId: string) => void;
}

interface ScheduledMarket {
  conditionId: string;
  openTimer?: ReturnType<typeof setTimeout>;
  closeTimer?: ReturnType<typeof setTimeout>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Schedules and persists open (+5s) and close (+2s, then poll until redemption)
 * price snapshots for auto-tracked Up/Down markets.
 */
export class MarketSurveillanceRecorder {
  private readonly scheduled = new Map<string, ScheduledMarket>();
  private readonly closeInFlight = new Set<string>();
  private readonly surveillanceService: AlgoSurveillanceService;

  constructor(
    dataSource: DataSource,
    private readonly priceFeed: CryptoAlgoPriceFeed | null,
    private readonly options?: SurveillanceRecorderOptions,
  ) {
    this.surveillanceService = new AlgoSurveillanceService(dataSource);
  }

  async refresh(markets: WatchedMarketInput[]): Promise<void> {
    await this.repairStaleCloseSnapshots();

    const activeIds = new Set(markets.map((m) => m.conditionId));
    for (const [conditionId, entry] of this.scheduled) {
      if (activeIds.has(conditionId)) continue;

      if (this.closeInFlight.has(conditionId)) continue;

      const snapshot = await this.surveillanceService.getByConditionId(conditionId);
      const pendingClose =
        snapshot != null &&
        !snapshot.unresolvedAt &&
        !snapshotHasRedemptionClose(snapshot);

      this.clearTimers(entry);

      if (pendingClose) {
        void this.captureClose(conditionId);
      } else {
        this.scheduled.delete(conditionId);
      }
    }

    await Promise.all(markets.map((market) => this.scheduleMarket(market)));
  }

  async captureOnResolved(
    conditionId: string,
    options?: { forceImmediate?: boolean },
  ): Promise<void> {
    const existing = await this.surveillanceService.getByConditionId(conditionId);
    if (existing && snapshotHasRedemptionClose(existing)) return;

    let gamma: GammaMarket | null = null;
    try {
      gamma = await fetchGammaMarket(conditionId);
    } catch (err) {
      log.warn({ err, conditionId }, 'gamma fetch failed for captureOnResolved');
    }

    const question = existing?.question ?? gamma?.question ?? null;
    const marketStartAt =
      existing?.marketStartAt ??
      resolveMarketStartDate(gamma?.eventStartTime, question);
    const marketEndAt = resolveSurveillanceEndAt(
      marketStartAt,
      gamma?.endDate ?? existing?.marketEndAt,
      existing?.interval,
    );

    if (marketEndAt) {
      await this.surveillanceService.upsertMeta({
        conditionId,
        marketEndAt,
      });
    }

    if (options?.forceImmediate) {
      void this.captureClose(conditionId);
      return;
    }

    const endMs = marketEndAt?.getTime() ?? null;
    this.scheduleCloseCapture(conditionId, endMs);
  }

  shutdown(): void {
    for (const entry of this.scheduled.values()) {
      this.clearTimers(entry);
    }
    this.scheduled.clear();
    this.closeInFlight.clear();
  }

  private async repairStaleCloseSnapshots(): Promise<void> {
    const stale = await this.surveillanceService.findNonRedemptionCloseSnapshots();
    for (const row of stale) {
      await this.surveillanceService.clearCloseSnapshot(row.conditionId);
      this.scheduleCloseCapture(row.conditionId, row.marketEndAt);
    }
  }

  private clearTimers(entry: ScheduledMarket): void {
    if (entry.openTimer) clearTimeout(entry.openTimer);
    if (entry.closeTimer) clearTimeout(entry.closeTimer);
  }

  private getOrCreateEntry(conditionId: string): ScheduledMarket {
    const entry = this.scheduled.get(conditionId) ?? { conditionId };
    this.scheduled.set(conditionId, entry);
    return entry;
  }

  private scheduleCloseCapture(conditionId: string, endAt: string | number | null): void {
    const entry = this.getOrCreateEntry(conditionId);
    if (entry.closeTimer) {
      clearTimeout(entry.closeTimer);
      entry.closeTimer = undefined;
    }

    const endMs =
      typeof endAt === 'number'
        ? endAt
        : endAt
          ? Date.parse(endAt)
          : NaN;

    if (!Number.isFinite(endMs)) {
      void this.captureClose(conditionId);
      return;
    }

    const delay = Math.max(0, endMs + CLOSE_SNAPSHOT_DELAY_MS - Date.now());
    if (delay === 0) {
      void this.captureClose(conditionId);
      return;
    }

    entry.closeTimer = setTimeout(() => {
      void this.captureClose(conditionId);
    }, delay);
  }

  private async scheduleMarket(market: WatchedMarketInput): Promise<void> {
    let gamma: GammaMarket | null = null;
    try {
      gamma = await fetchGammaMarket(market.conditionId);
    } catch (err) {
      log.warn({ err, conditionId: market.conditionId }, 'gamma fetch failed for surveillance');
    }

    const question = market.question ?? gamma?.question ?? null;
    const marketStartAt = resolveMarketStartDate(gamma?.eventStartTime, question);
    const marketEndAt = resolveSurveillanceEndAt(
      marketStartAt,
      gamma?.endDate,
      market.interval,
    );

    await this.surveillanceService.upsertMeta({
      conditionId: market.conditionId,
      question,
      cryptoSymbol: market.cryptoSymbol ?? null,
      interval: market.interval ?? null,
      slug: market.slug ?? gamma?.slug ?? null,
      marketStartAt,
      marketEndAt,
    });

    const existing = await this.surveillanceService.getByConditionId(market.conditionId);
    const entry = this.getOrCreateEntry(market.conditionId);
    this.clearTimers(entry);

    const now = Date.now();
    const startMs = marketStartAt ? Date.parse(marketStartAt) : NaN;
    const endMs = marketEndAt ? marketEndAt.getTime() : NaN;

    if (!existing?.openCapturedAt && Number.isFinite(startMs)) {
      const openAt = startMs + OPEN_SNAPSHOT_DELAY_MS;
      const delay = Math.max(0, openAt - now);
      if (delay === 0 && now < endMs) {
        void this.captureOpen(market.conditionId);
      } else if (delay > 0) {
        entry.openTimer = setTimeout(() => {
          void this.captureOpen(market.conditionId);
        }, delay);
      }
    }

    if (!existing || !snapshotHasRedemptionClose(existing)) {
      if (Number.isFinite(endMs)) {
        this.scheduleCloseCapture(market.conditionId, endMs);
      }
    }
  }

  private async resolveOpenPrices(conditionId: string): Promise<OutcomePrices> {
    const wsPrices = this.priceFeed?.getOutcomePrices(conditionId);
    if (wsPrices && (wsPrices.upPrice != null || wsPrices.downPrice != null)) {
      return wsPrices;
    }

    try {
      const gamma = await fetchGammaMarket(conditionId);
      return parseUpDownPricesFromGamma(gamma);
    } catch {
      return { upPrice: null, downPrice: null };
    }
  }

  private async captureOpen(conditionId: string): Promise<void> {
    try {
      const prices = await this.resolveOpenPrices(conditionId);
      const saved = await this.surveillanceService.recordOpenSnapshot(conditionId, prices);
      if (saved) {
        log.info({ conditionId, ...prices }, 'open surveillance snapshot recorded');
        this.options?.onOpenCaptured?.(conditionId);
      }
    } catch (err) {
      log.error({ err, conditionId }, 'captureOpen failed');
    }
  }

  private async captureClose(conditionId: string): Promise<void> {
    if (this.closeInFlight.has(conditionId)) return;

    this.closeInFlight.add(conditionId);
    try {
      const existing = await this.surveillanceService.getByConditionId(conditionId);
      if (existing && snapshotHasRedemptionClose(existing)) return;

      const deadline = Date.now() + SURVEILLANCE_CLOSE_TTL_MS;

      while (Date.now() < deadline) {
        let gamma: GammaMarket | null = null;
        try {
          gamma = await fetchGammaMarket(conditionId);
        } catch (err) {
          log.warn({ err, conditionId }, 'gamma fetch failed while waiting for resolution');
        }

        if (gamma) {
          const prices = tryRedemptionPricesFromGamma(gamma);
          if (prices) {
            const winningOutcome = resolveUpDownWinnerLabel(gamma);
            const saved = await this.surveillanceService.recordCloseSnapshot(
              conditionId,
              prices,
              winningOutcome,
            );
            if (saved) {
              log.info(
                { conditionId, ...prices, winningOutcome },
                'close surveillance snapshot recorded (redemption)',
              );
            }
            return;
          }
        }

        await sleep(CLOSE_RESOLUTION_POLL_MS);
      }

      log.warn(
        { conditionId, waitedMs: SURVEILLANCE_CLOSE_TTL_MS },
        'close snapshot skipped — resolution not available in time, trying market fallback',
      );

      const resolvedByMarket = await this.surveillanceService.resolveFallbackCloseFromMarket(
        conditionId,
      );
      if (resolvedByMarket) {
        log.info(
          { conditionId },
          'close surveillance snapshot recorded via market fallback',
        );
      }
    } catch (err) {
      log.error({ err, conditionId }, 'captureClose failed');
    } finally {
      this.closeInFlight.delete(conditionId);
    }
  }
}
