import {
  computeExecutableBidVwap,
  computeExecutableAskVwap,
  computeExecutableSpread,
  computeTopOfBook,
} from '@polywatch/core';
import type { OrderBook, LiquidityStatus } from '@polywatch/core';
import pino from 'pino';
import { fetchOrderBook } from './api-client.js';
import { MarketMetricsCache } from './market-metrics-cache.js';
import { PolymarketBookWebSocket } from './websocket-book.js';
import { safeInterval } from '../helpers.js';
import { BOOK_SUBSCRIPTION_SYNC_MS } from '../constants.js';
import { isFreshBook } from './book-freshness.js';

export type FetchBookOptions = {
  /** When set, cached books older than this are ignored and REST is used. */
  maxAgeMs?: number;
};


const log = pino({ name: 'connection-manager' });

/** Max bid price among levels that have positive size (ignores phantom quotes). */
export function maxSizedBidPrice(book: Pick<OrderBook, 'bids'>): number {
  let best = 0;
  for (const level of book.bids) {
    if (level.size > 0 && level.price > best) {
      best = level.price;
    }
  }
  return best;
}

export interface SellPricesWithDepth {
  executableBidVwap: number;
  executableAskVwap: number;
  liquidityStatus: LiquidityStatus;
  /** Highest bid price among levels with size > 0 (0 if none). */
  sizedBestBid: number;
}

export class PolymarketConnectionManager {
  private orderBooks = new Map<string, OrderBook>();
  private assetRefCount = new Map<string, number>();
  private bookHealthy = true;
  private onBookUpdate?: (assetId: string) => void;
  private wsClient: PolymarketBookWebSocket;
  private metricsCache = new MarketMetricsCache();
  private browseConditionIds = new Map<string, string>();
  private browseOutcomes = new Map<string, string>();

  constructor() {
    this.wsClient = new PolymarketBookWebSocket();
    this.wsClient.setMetricsCache(this.metricsCache);
    this.wsClient.setOnBookUpdate((assetId: string) => {
      this.syncWsBook(assetId);
    });
  }

  setBrowseMarketMeta(
    conditionIds: Map<string, string>,
    outcomes: Map<string, string>,
  ): void {
    this.browseConditionIds = conditionIds;
    this.browseOutcomes = outcomes;
    for (const [assetId, conditionId] of conditionIds) {
      this.metricsCache.setConditionId(assetId, conditionId);
    }
    for (const [assetId, outcome] of outcomes) {
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

  getWsClient(): PolymarketBookWebSocket {
    return this.wsClient;
  }

  setOnBookUpdate(cb: (assetId: string) => void): void {
    this.onBookUpdate = cb;
  }

  isBookConnectionHealthy(): boolean {
    return this.bookHealthy && this.wsClient.isHealthy();
  }

  reconcileActiveAssets(assetIds: string[]): void {
    const next = new Map<string, number>();
    for (const assetId of assetIds) {
      next.set(assetId, (next.get(assetId) ?? 0) + 1);
    }

    for (const assetId of this.assetRefCount.keys()) {
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
      const data = await fetchOrderBook(assetId);
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

  /**
   * Always hit CLOB REST and replace the local cache. Used by sim T1 match so
   * latency is not a no-op against a stale T0 snapshot from `fetchBook`.
   */
  async forceRefreshBook(assetId: string): Promise<OrderBook | undefined> {
    try {
      const data = await fetchOrderBook(assetId);
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

  async fetchSellExecutablePrices(assetId: string, quantity: number) {
    const fromCache = this.getExecutablePrices(assetId, quantity);
    if (fromCache.executableBidVwap > 0) {
      return fromCache;
    }

    try {
      const data = await fetchOrderBook(assetId);
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

  /**
   * Captures the book snapshot ONCE and computes the position-qty VWAP
   * (for order emission and SL/TP decisions) plus the top-of-book sized best bid.
   */
  async fetchSellExecutablePricesWithDepth(
    assetId: string,
    positionQuantity: number,
    refQuantity: number,
  ): Promise<SellPricesWithDepth> {
    let book = this.orderBooks.get(assetId);
    if (!book || book.bids.length === 0) {
      try {
        const data = await fetchOrderBook(assetId);
        book = {
          assetId,
          bids: data.bids,
          asks: data.asks,
          updatedAt: new Date(),
        };
        this.orderBooks.set(assetId, book);
      } catch (err) {
        log.warn({ err, assetId }, 'sell book REST fallback failed (depth)');
        return {
          executableBidVwap: 0,
          executableAskVwap: 0,
          liquidityStatus: 'illiquid' as const,
          sizedBestBid: 0,
        };
      }
    }

    const posResult = computeExecutableBidVwap(book, positionQuantity);
    const askResult = computeExecutableAskVwap(book, positionQuantity);
    const sizedBestBid = maxSizedBidPrice(book);

    return {
      executableBidVwap: posResult.vwap,
      executableAskVwap: askResult.vwap,
      liquidityStatus: posResult.liquidityStatus,
      sizedBestBid,
    };
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
      const data = await fetchOrderBook(assetId);
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
    for (const assetId of this.assetRefCount.keys()) {
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
  syncWsBook(assetId: string): boolean {
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
      this.metricsCache.updateTopOfBook(assetId, top.bestBid, top.bestAsk, top.spreadTop);
    }
    this.onBookUpdate?.(assetId);
  }
}