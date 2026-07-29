import type { DataSource } from 'typeorm';
import pino from 'pino';
import type {
  AlgoPriceTickRecordInput,
  IPolymarketConnectionManager,
  OutcomeSideSnapshot,
} from '@polywatch/core';
import {
  AlgoPriceTickService,
  AlgoSurveillanceService,
  buildAlgoPriceTickRecordInput,
  chartTickFromRecordInput,
  nullableAskVwap,
  parseActiveMarketWindow,
  safeInterval,
  topBookSize,
} from '@polywatch/core';
import type { AlgoChartTickPublisher } from './algo-chart-tick-publisher.js';
import type { CryptoAlgoPriceFeed } from './price-feed.js';
import type { PositionContextCache } from './position-context-cache.js';
import type { SignalStateRegistry } from './signal-state-registry.js';

const log = pino({ name: 'crypto-algo:price-tick-recorder' });
const DEFAULT_TICK_INTERVAL_MS = 1_000;
const DEFAULT_CLEANUP_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const EMPTY_POSITION_METRICS = { count: 0, exposureUsd: 0, unrealizedPnl: 0 };

interface ActiveMarket {
  conditionId: string;
  marketStartMs: number;
  marketEndMs: number;
}

interface LastMid {
  up: number | null;
  down: number | null;
}

export interface PriceTickRecorderDeps {
  priceFeed: CryptoAlgoPriceFeed | null;
  connectionManager: IPolymarketConnectionManager | null;
  refQty: number;
  signalRegistry: SignalStateRegistry | null;
  positionCache: PositionContextCache | null;
  chartTickPublisher: AlgoChartTickPublisher | null;
}

export class PriceTickRecorder {
  private readonly tickService: AlgoPriceTickService;
  private readonly surveillanceService: AlgoSurveillanceService;
  private readonly activeMarkets = new Map<string, ActiveMarket>();
  private readonly lastMidByCondition = new Map<string, LastMid>();
  private timer: NodeJS.Timeout | null = null;
  private tickIntervalMs = DEFAULT_TICK_INTERVAL_MS;
  private cleanupMaxAgeMs = DEFAULT_CLEANUP_MAX_AGE_MS;

  constructor(
    private readonly ds: DataSource,
    private deps: PriceTickRecorderDeps,
  ) {
    this.tickService = new AlgoPriceTickService(ds);
    this.surveillanceService = new AlgoSurveillanceService(ds);
  }

  /** Hot-reload tick interval, retention and refQty from CryptoConfig. */
  configure(opts: {
    tickIntervalMs?: number;
    retentionHours?: number;
    refQty?: number;
  }): void {
    if (opts.refQty != null) {
      this.deps.refQty = opts.refQty;
    }
    if (opts.retentionHours != null) {
      this.cleanupMaxAgeMs = opts.retentionHours * 60 * 60 * 1000;
    }
    if (opts.tickIntervalMs != null && opts.tickIntervalMs !== this.tickIntervalMs) {
      this.tickIntervalMs = opts.tickIntervalMs;
      if (this.timer) {
        clearInterval(this.timer);
        this.timer = null;
        this.ensureTimerRunning();
      }
    }
  }

  getActiveConditionIds(): string[] {
    return Array.from(this.activeMarkets.keys());
  }

  async refreshActiveMarkets(): Promise<void> {
    try {
      const liveSnapshots = await this.surveillanceService.findLiveMarkets();
      const now = Date.now();
      const next = new Map<string, ActiveMarket>();

      for (const snap of liveSnapshots) {
        const window = parseActiveMarketWindow(
          snap.conditionId,
          snap.marketStartAt,
          snap.marketEndAt,
          now,
        );
        if (window) next.set(window.conditionId, window);
      }

      this.syncActiveMarkets(next);
    } catch (err) {
      log.warn({ err }, 'failed to refresh active markets');
    }
  }

  async addMarket(conditionId: string): Promise<void> {
    if (this.activeMarkets.has(conditionId)) return;
    try {
      const snap = await this.surveillanceService.getByConditionId(conditionId);
      const window = parseActiveMarketWindow(
        conditionId,
        snap?.marketStartAt,
        snap?.marketEndAt,
      );
      if (!window) return;

      this.activeMarkets.set(conditionId, window);
      this.ensureTimerRunning();
    } catch (err) {
      log.warn({ err, conditionId }, 'failed to add market to tick recorder');
    }
  }

  removeMarket(conditionId: string): void {
    this.activeMarkets.delete(conditionId);
    this.lastMidByCondition.delete(conditionId);
    this.deps.signalRegistry?.remove(conditionId);
    this.stopTimerIfIdle();
  }

  private syncActiveMarkets(next: Map<string, ActiveMarket>): void {
    for (const conditionId of this.activeMarkets.keys()) {
      if (!next.has(conditionId)) {
        this.lastMidByCondition.delete(conditionId);
      }
    }

    this.activeMarkets.clear();
    for (const [k, v] of next) this.activeMarkets.set(k, v);
    this.reconcileTimer();
  }

  private ensureTimerRunning(): void {
    if (!this.timer) {
      this.timer = safeInterval(
        () => this.tick(),
        this.tickIntervalMs,
        'crypto-algo:price-tick-recorder',
      );
    }
  }

  private stopTimerIfIdle(): void {
    if (this.activeMarkets.size === 0 && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private reconcileTimer(): void {
    if (this.activeMarkets.size > 0) {
      this.ensureTimerRunning();
    } else {
      this.stopTimerIfIdle();
    }
  }

  private collectOutcomeSide(
    tokenId: string | null | undefined,
    book: { bid: number | null; ask: number | null; updatedAt: number } | null,
  ): OutcomeSideSnapshot {
    const cm = this.deps.connectionManager;
    const sizes = topBookSize(tokenId ? cm?.getOrderBook(tokenId) : undefined);
    const vwapResult = tokenId
      ? cm?.getExecutablePrices(tokenId, this.deps.refQty)
      : null;
    const cacheRow = tokenId ? cm?.getMetricsCache().get(tokenId) : undefined;

    return {
      book,
      bidSize: sizes.bidSize,
      askSize: sizes.askSize,
      askVwap: vwapResult
        ? nullableAskVwap(vwapResult.executableAskVwap, vwapResult.liquidityStatus)
        : null,
      liquidityStatus: vwapResult?.liquidityStatus ?? null,
      lastTradePrice: cacheRow?.lastTradePrice ?? null,
      lastTradeSize: cacheRow?.lastTradeSize ?? null,
    };
  }

  private buildRecordInput(
    conditionId: string,
    market: ActiveMarket,
    now: number,
  ): AlgoPriceTickRecordInput | null {
    const prices = this.deps.priceFeed?.getOutcomePrices(conditionId);
    if (!prices) return null;
    if (prices.upPrice == null && prices.downPrice == null) return null;

    const books = this.deps.priceFeed?.getOutcomeBooks(conditionId);
    const prevMid = this.lastMidByCondition.get(conditionId) ?? null;

    const input = buildAlgoPriceTickRecordInput({
      conditionId,
      upPrice: prices.upPrice,
      downPrice: prices.downPrice,
      up: this.collectOutcomeSide(books?.tokenIdYes, books?.up ?? null),
      down: this.collectOutcomeSide(books?.tokenIdNo, books?.down ?? null),
      marketEndMs: market.marketEndMs,
      now,
      wsHealthy: this.deps.priceFeed?.isHealthy() ?? null,
      prevMid,
      positionMetrics:
        this.deps.positionCache?.getMetrics(conditionId) ??
        EMPTY_POSITION_METRICS,
      lastSignal: this.deps.signalRegistry?.getLast(conditionId) ?? null,
      lastAbstain: this.deps.signalRegistry?.getLastAbstain(conditionId) ?? null,
      recordedAt: now,
    });

    this.lastMidByCondition.set(conditionId, {
      up: prices.upPrice,
      down: prices.downPrice,
    });

    return input;
  }

  private async tick(): Promise<void> {
    const now = Date.now();
    for (const [conditionId, market] of this.activeMarkets) {
      if (now < market.marketStartMs || now > market.marketEndMs + this.tickIntervalMs) continue;

      const input = this.buildRecordInput(conditionId, market, now);
      if (!input) continue;

      try {
        await this.tickService.recordTick(input);
        this.deps.chartTickPublisher?.pushTick(
          chartTickFromRecordInput(input, now),
        );
      } catch (err) {
        log.warn({ err, conditionId }, 'failed to record price tick');
      }
    }
  }

  async cleanupOldTicks(): Promise<void> {
    try {
      const deleted = await this.tickService.deleteOlderThan(this.cleanupMaxAgeMs);
      if (deleted > 0) {
        log.info({ deleted }, 'old price ticks cleaned up');
      }
    } catch (err) {
      log.warn({ err }, 'price tick cleanup failed');
    }
  }

  shutdown(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.activeMarkets.clear();
    this.lastMidByCondition.clear();
  }
}
