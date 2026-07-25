import type { OrderBook } from '@polywatch/core';
import {
  computeExecutableAskVwap,
  computeExecutableBidVwap,
  computeExecutableSpread,
  computeTopOfBook,
  safeInterval,
} from '@polywatch/core';
import pino from 'pino';
import type { PolymarketConnectionConfig } from './connection-config.js';
import { fetchOrderBook } from './api-client.js';
import { MarketMetricsCache } from './market-metrics-cache.js';
import { PolymarketBookWebSocket } from './websocket-book.js';
import { isFreshBook } from './book-freshness.js';

export type FetchBookOptions = {
  /** When set, cached books older than this are ignored and REST is used. */
  maxAgeMs?: number;
};

const log = pino({ name: 'connection-manager' });

/** Default interval for periodic book refresh (10 seconds). */
const BOOK_SUBSCRIPTION_SYNC_MS = 10_000;

export class PolymarketConnectionManager {
  private orderBooks = new Map<string, OrderBook>();
  private assetRefCount = new Map<string, number>();
  private bookHealthy = true;
  private onBookUpdate?: (assetId: string) => void;
  private wsClient: PolymarketBookWebSocket;
  private metricsCache = new MarketMetricsCache();
  private browseConditionIds = new Map<string, string>();
  private browseOutcomes = new Map<string, string>();
  private readonly config: PolymarketConnectionConfig;

  constructor(config: PolymarketConnectionConfig) {
    this.config = config;
    this.wsClient = new PolymarketBookWebSocket(config);
    this.wsClient.setMetricsCache(this.metricsCache);
    this.wsClient.setOnBookUpdate((assetId: string) => {
      this.syncWsBook(assetId);
    });
  }

  /**
   * Register browse-grid market metadata so that live book updates can be mapped
   * back to percent updates for the frontend market cards.
   */
  setBrowseMarketMeta(
    conditionIds: Map<string, string>,
    outcomes: Map<string, string>,
  ): void {
    this.browseConditionIds = conditionIds;
    this.browseOutcomes = outcomes;
    for (const [assetId, conditionId] of Array.from(conditionIds.entries())) {
      this.metricsCache.setConditionId(assetId, conditionId);
    }
    for (const [assetId, outcome] of Array.from(outcomes.entries())) {
      this.metricsCache.setOutcome(assetId, outcome);
    }
  }

  getMetricsCache(): MarketMetricsCache {
    return this.metricsCache;
  }

  getExecutableSpread(assetId: string, quantity: number): number | undefined {
    const book = this.orderBooks.get(assetId);
    if (!book) return undefined;
    return computeExecutableSpread(book, quantity);
  }

  /** Expose the underlying WebSocket client for lifecycle management. */
  getWsClient(): PolymarketBookWebSocket {
    return this.wsClient;
  }

  setOnBookUpdate(cb: (assetId: string) => void): void {
    this.onBookUpdate = cb;
  }

  setOnMarketResolved(cb: (conditionId: string) => void): void {
    this.wsClient.setOnMarketResolved(cb);
  }

  isBookConnectionHealthy(): boolean {
    return this.bookHealthy && this.wsClient.isHealthy();
  }

  reconcileActiveAssets(assetIds: string[]): void {
    const next = new Map<string, number>();
    for (const assetId of assetIds) {
      next.set(assetId, (next.get(assetId) ?? 0) + 1);
    }

    for (const assetId of Array.from(this.assetRefCount.keys())) {
      if (!next.has(assetId)) {
        this.orderBooks.delete(assetId);
      }
    }

    this.assetRefCount = next;
  }

  getOrderBook(assetId: string): OrderBook | undefined {
    return this.orderBooks.get(assetId);
  }

  getExecutablePrices(assetId: string, quantity: number) {
    const book = this.orderBooks.get(assetId);
    if (!book) {
      return {
        executableBidVwap: 0,
        executableAskVwap: 0,
        liquidityStatus: 'illiquid' as const,
      };
    }
    return this.pricesFromBook(book, quantity);
  }

  /**
   * Return the WS-backed in-memory book, falling back to a one-shot REST
   * fetch (cached) when the asset is not subscribed.
   */
  async fetchBook(
    assetId: string,
    options?: FetchBookOptions,
  ): Promise<OrderBook | undefined> {
    const local = this.orderBooks.get(assetId);
    const maxAgeMs = options?.maxAgeMs;
    if (local && (maxAgeMs == null || isFreshBook(local, Date.now(), maxAgeMs))) {
      return local;
    }

    try {
      const data = await fetchOrderBook(this.config.clobApi, assetId);
      const book: OrderBook = {
        assetId,
        bids: data.bids,
        asks: data.asks,
        updatedAt: new Date(),
      };
      this.orderBooks.set(assetId, book);
      return book;
    } catch (err) {
      log.warn({ err, assetId }, 'one-off book fetch failed');
      return undefined;
    }
  }

  /** Always hit CLOB REST and replace the local cache (entry depth retries). */
  async forceRefreshBook(assetId: string): Promise<OrderBook | undefined> {
    try {
      const data = await fetchOrderBook(this.config.clobApi, assetId);
      const book: OrderBook = {
        assetId,
        bids: data.bids,
        asks: data.asks,
        updatedAt: new Date(),
      };
      this.orderBooks.set(assetId, book);
      this.bookHealthy = true;
      return book;
    } catch (err) {
      log.warn({ err, assetId }, 'force book refresh failed');
      this.bookHealthy = false;
      return undefined;
    }
  }

  async fetchExecutablePrices(
    assetId: string,
    quantity: number,
    options?: FetchBookOptions,
  ) {
    const book = await this.fetchBook(assetId, options);
    if (!book) {
      return {
        executableBidVwap: 0,
        executableAskVwap: 0,
        liquidityStatus: 'illiquid' as const,
      };
    }
    return this.pricesFromBook(book, quantity);
  }

  /**
   * Executable bid for live SELL orders — mirrors sim's `fetchBook` path.
   * Uses the WS-backed cache when it yields a positive bid; otherwise fetches
   * a fresh REST snapshot (covers missing subscription and stale empty books).
   */
  async fetchSellExecutablePrices(assetId: string, quantity: number) {
    const fromCache = this.getExecutablePrices(assetId, quantity);
    if (fromCache.executableBidVwap > 0) {
      return fromCache;
    }

    try {
      const data = await fetchOrderBook(this.config.clobApi, assetId);
      const book: OrderBook = {
        assetId,
        bids: data.bids,
        asks: data.asks,
        updatedAt: new Date(),
      };
      this.orderBooks.set(assetId, book);
      return this.pricesFromBook(book, quantity);
    } catch (err) {
      log.warn({ err, assetId }, 'sell book REST fallback failed');
      return fromCache;
    }
  }

  private pricesFromBook(book: OrderBook, quantity: number) {
    const bid = computeExecutableBidVwap(book, quantity);
    const ask = computeExecutableAskVwap(book, quantity);
    return {
      executableBidVwap: bid.vwap,
      executableAskVwap: ask.vwap,
      liquidityStatus: bid.liquidityStatus,
      askLiquidityStatus: ask.liquidityStatus,
    };
  }

  async refreshBook(assetId: string): Promise<void> {
    if (this.wsClient.isHealthy()) {
      const wsBook = this.wsClient.getBook(assetId);
      if (wsBook) {
        this.cacheBook(assetId, wsBook);
        return;
      }
    }

    try {
      const data = await fetchOrderBook(this.config.clobApi, assetId);
      this.cacheBook(assetId, {
        assetId,
        bids: data.bids,
        asks: data.asks,
        updatedAt: new Date(),
      });
    } catch (err) {
      log.warn({ err, assetId }, 'book refresh failed');
      this.bookHealthy = false;
    }
  }

  async refreshAllActive(): Promise<void> {
    for (const assetId of Array.from(this.assetRefCount.keys())) {
      await this.refreshBook(assetId);
    }
  }

  startPeriodicRefresh(
    intervalMs = BOOK_SUBSCRIPTION_SYNC_MS,
    onBeforeRefresh?: () => Promise<void>,
  ): NodeJS.Timeout {
    return safeInterval(async () => {
      await onBeforeRefresh?.();
      await this.refreshAllActive();
    }, intervalMs, 'connection-manager-periodic-refresh');
  }

  /** Copy the WS client's in-memory book into the strategy cache. */
  private syncWsBook(assetId: string): boolean {
    const wsBook = this.wsClient.getBook(assetId);
    if (!wsBook) return false;

    const conditionId = this.browseConditionIds.get(assetId);
    const outcome = this.browseOutcomes.get(assetId);
    if (conditionId) {
      this.metricsCache.setConditionId(assetId, conditionId);
    }
    if (outcome) {
      this.metricsCache.setOutcome(assetId, outcome);
    }

    this.cacheBook(assetId, wsBook);
    return true;
  }

  private cacheBook(assetId: string, book: OrderBook): void {
    this.orderBooks.set(assetId, book);
    this.bookHealthy = true;
    const top = computeTopOfBook(book);
    if (top) {
      this.metricsCache.updateTopOfBook(
        assetId,
        top.bestBid,
        top.bestAsk,
        top.spreadTop,
      );
    }
    this.onBookUpdate?.(assetId);
  }
}