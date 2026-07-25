import pino from 'pino';
import type {
  IBookWsClient,
  IPolymarketConnectionManager,
  MarketService,
  OutcomePrices,
} from '@polywatch/core';
import type { TopOfBookData } from './strategy/index.js';
import { MidHistoryBuffer, type MidHistorySample } from './mid-history-buffer.js';

const log = pino({ name: 'crypto-algo:price-feed' });

/**
 * Minimum time between strategy evaluations for the same conditionId.
 * Prevents over-evaluation on highly active markets.
 */
const DEFAULT_DEBOUNCE_MS = 5_000;

/**
 * Cache entry for top-of-book data from WebSocket.
 * Bid/ask may be null when the book is unilateral.
 */
interface TopOfBook {
  assetId: string;
  bid: number | null;
  ask: number | null;
  spread: number | null;
  midPrice: number | null;
  spreadPercent: number | null;
  updatedAt: number;
}

/**
 * Maps conditionId to its YES and NO token IDs.
 * Required to subscribe to WebSocket updates.
 */
interface AssetMapping {
  conditionId: string;
  tokenIdYes: string | null;
  tokenIdNo: string | null;
}

/**
 * Callback fired when a significant price change is detected.
 * The update is a trigger only — callers must re-resolve books via
 * {@link CryptoAlgoPriceFeed.getOutcomeBooks}.
 */
export type PriceUpdateCallback = (
  conditionId: string,
  assetId: string,
) => void;

/**
 * Callback fired when a market resolves.
 */
export type MarketResolvedCallback = (conditionId: string) => void | Promise<void>;

function toTopOfBookData(tob: TopOfBook): TopOfBookData {
  return {
    assetId: tob.assetId,
    bid: tob.bid,
    ask: tob.ask,
    spread: tob.spread,
    midPrice: tob.midPrice,
    spreadPercent: tob.spreadPercent,
    updatedAt: tob.updatedAt,
  };
}

/**
 * WebSocket price feed for crypto-algo strategies.
 *
 * Subscribes to Polymarket CLOB WebSocket for real-time book updates,
 * maintains a cache of top-of-book prices per asset, and triggers
 * strategy evaluation on significant price changes.
 */
export class CryptoAlgoPriceFeed {
  private readonly midHistory = new MidHistoryBuffer();
  private readonly topOfBook = new Map<string, TopOfBook>();
  private readonly conditionToAssets = new Map<
    string,
    { tokenIdYes: string | null; tokenIdNo: string | null }
  >();
  private debounceMs = DEFAULT_DEBOUNCE_MS;
  private readonly assetToCondition = new Map<string, string>();
  private readonly lastEval = new Map<string, number>();
  private readonly pendingEvals = new Map<string, NodeJS.Timeout>();

  private onPriceUpdate?: PriceUpdateCallback;
  private onMarketResolved?: MarketResolvedCallback;
  private connectionManager: IPolymarketConnectionManager | null = null;
  private wsClient: IBookWsClient | null = null;
  private connected = false;

  setConnectionManager(cm: IPolymarketConnectionManager): void {
    this.connectionManager = cm;
    this.wsClient = cm.getWsClient();

    this.wsClient.setOnMarketResolved((conditionId: string) => {
      this.handleMarketResolved(conditionId);
    });
  }

  dispatchBookUpdate(assetId: string): void {
    this.handleBookUpdate(assetId);
  }

  setOnPriceUpdate(cb: PriceUpdateCallback): void {
    this.onPriceUpdate = cb;
  }

  setOnMarketResolved(cb: MarketResolvedCallback): void {
    this.onMarketResolved = cb;
  }

  /** Configure WS evaluation debounce (from RiskConfig). */
  setDebounceMs(ms: number): void {
    this.debounceMs = ms;
  }

  async connect(): Promise<void> {
    if (!this.wsClient) {
      throw new Error('WebSocket client not initialized - call setConnectionManager first');
    }

    if (this.connected) {
      log.warn('price feed already connected');
      return;
    }

    try {
      await (this.wsClient as any).connect?.();
      this.connected = true;
      log.info('crypto-algo price feed connected');
    } catch (err) {
      log.error({ err }, 'failed to connect price feed');
      throw err;
    }
  }

  disconnect(): void {
    for (const timer of Array.from(this.pendingEvals.values())) {
      clearTimeout(timer);
    }
    this.pendingEvals.clear();
    this.midHistory.clearAll();
    this.connected = false;
    log.info('crypto-algo price feed disconnected');
  }

  async subscribeToMarkets(
    conditionIds: string[],
    marketService: MarketService,
  ): Promise<void> {
    if (!this.wsClient || !this.connected) {
      log.warn('cannot subscribe - price feed not connected');
      return;
    }

    try {
      const assetIds: string[] = [];

      for (const conditionId of conditionIds) {
        const market = await marketService.ensureTradableMarket(conditionId);
        if (!market) {
          log.warn({ conditionId }, 'market not found for subscription');
          continue;
        }

        const mapping: AssetMapping = {
          conditionId,
          tokenIdYes: market.tokenIdYes,
          tokenIdNo: market.tokenIdNo,
        };

        this.conditionToAssets.set(conditionId, {
          tokenIdYes: market.tokenIdYes,
          tokenIdNo: market.tokenIdNo,
        });

        if (market.tokenIdYes) {
          this.assetToCondition.set(market.tokenIdYes, conditionId);
          assetIds.push(market.tokenIdYes);
        }
        if (market.tokenIdNo) {
          this.assetToCondition.set(market.tokenIdNo, conditionId);
          assetIds.push(market.tokenIdNo);
        }
      }

      this.wsClient.reconcile(assetIds);
      log.info({ count: assetIds.length, markets: conditionIds.length }, 'subscribed to markets');
    } catch (err) {
      log.error({ err, count: conditionIds.length }, 'subscribeToMarkets failed — partial subscriptions may be in place');
    }
  }

  unsubscribeStale(activeConditionIds: string[]): void {
    const activeSet = new Set(activeConditionIds);
    const toRemove: string[] = [];

    for (const conditionId of Array.from(this.conditionToAssets.keys())) {
      if (!activeSet.has(conditionId)) {
        toRemove.push(conditionId);
      }
    }

    for (const conditionId of toRemove) {
      this.cancelPendingEval(conditionId);
      const mapping = this.conditionToAssets.get(conditionId);
      if (mapping) {
        if (mapping.tokenIdYes) {
          this.assetToCondition.delete(mapping.tokenIdYes);
          this.topOfBook.delete(mapping.tokenIdYes);
          this.midHistory.clear(mapping.tokenIdYes);
        }
        if (mapping.tokenIdNo) {
          this.assetToCondition.delete(mapping.tokenIdNo);
          this.topOfBook.delete(mapping.tokenIdNo);
          this.midHistory.clear(mapping.tokenIdNo);
        }
      }
      this.conditionToAssets.delete(conditionId);
      this.lastEval.delete(conditionId);
    }

    const remainingAssets: string[] = [];
    for (const mapping of Array.from(this.conditionToAssets.values())) {
      if (mapping.tokenIdYes) remainingAssets.push(mapping.tokenIdYes);
      if (mapping.tokenIdNo) remainingAssets.push(mapping.tokenIdNo);
    }

    if (this.wsClient) {
      this.wsClient.reconcile(remainingAssets);
    }

    log.debug({ removed: toRemove.length }, 'unsubscribed from stale markets');
  }

  getTopOfBook(assetId: string): TopOfBook | null {
    return this.topOfBook.get(assetId) ?? null;
  }

  getYesMidPrice(conditionId: string): number | null {
    const mapping = this.conditionToAssets.get(conditionId);
    if (!mapping?.tokenIdYes) return null;

    const tob = this.topOfBook.get(mapping.tokenIdYes);
    return tob?.midPrice ?? null;
  }

  getNoMidPrice(conditionId: string): number | null {
    const mapping = this.conditionToAssets.get(conditionId);
    if (!mapping?.tokenIdNo) return null;

    const tob = this.topOfBook.get(mapping.tokenIdNo);
    return tob?.midPrice ?? null;
  }

  getOutcomePrices(conditionId: string): OutcomePrices {
    return {
      upPrice: this.getYesMidPrice(conditionId),
      downPrice: this.getNoMidPrice(conditionId),
    };
  }

  getOutcomeBooks(conditionId: string): {
    up: TopOfBookData | null;
    down: TopOfBookData | null;
    tokenIdYes: string | null;
    tokenIdNo: string | null;
  } {
    const mapping = this.conditionToAssets.get(conditionId);
    if (!mapping) {
      return {
        up: null,
        down: null,
        tokenIdYes: null,
        tokenIdNo: null,
      };
    }

    const upRaw = mapping.tokenIdYes
      ? (this.topOfBook.get(mapping.tokenIdYes) ?? null)
      : null;
    const downRaw = mapping.tokenIdNo
      ? (this.topOfBook.get(mapping.tokenIdNo) ?? null)
      : null;

    return {
      up: upRaw ? toTopOfBookData(upRaw) : null,
      down: downRaw ? toTopOfBookData(downRaw) : null,
      tokenIdYes: mapping.tokenIdYes,
      tokenIdNo: mapping.tokenIdNo,
    };
  }

  getSpreadPercent(conditionId: string): number | null {
    const mapping = this.conditionToAssets.get(conditionId);
    if (!mapping?.tokenIdYes) return null;

    const tob = this.topOfBook.get(mapping.tokenIdYes);
    return tob?.spreadPercent ?? null;
  }

  /**
   * @deprecated Prefer {@link getOutcomeBooks}. Kept for transitional callers.
   */
  getTopOfBookForCondition(conditionId: string): TopOfBookData | null {
    return this.getOutcomeBooks(conditionId).up;
  }

  isHealthy(): boolean {
    return this.connected && (this.wsClient?.isHealthy() ?? false);
  }

  async syncAll(): Promise<void> {
    if (this.wsClient) {
      await this.wsClient.syncAll();
    }
  }

  clearTopOfBook(conditionId: string): void {
    this.cancelPendingEval(conditionId);
    const mapping = this.conditionToAssets.get(conditionId);
    if (!mapping) return;

    if (mapping.tokenIdYes) {
      this.topOfBook.delete(mapping.tokenIdYes);
    }
    if (mapping.tokenIdNo) {
      this.topOfBook.delete(mapping.tokenIdNo);
    }
    this.midHistory.clearCondition(mapping.tokenIdYes, mapping.tokenIdNo);

    log.debug({ conditionId }, 'cleared topOfBook cache for condition');
  }

  getMidWindow(
    assetId: string | null | undefined,
    lookbackMs: number,
    nowMs: number,
  ): MidHistorySample[] {
    if (!assetId) return [];
    return this.midHistory.getWindow(assetId, lookbackMs, nowMs);
  }

  getOutcomeMidHistory(
    conditionId: string,
    lookbackMs: number,
    nowMs: number,
  ): { up: MidHistorySample[]; down: MidHistorySample[] } {
    const mapping = this.conditionToAssets.get(conditionId);
    if (!mapping) {
      return { up: [], down: [] };
    }
    return {
      up: this.getMidWindow(mapping.tokenIdYes, lookbackMs, nowMs),
      down: this.getMidWindow(mapping.tokenIdNo, lookbackMs, nowMs),
    };
  }

  private cancelPendingEval(conditionId: string): void {
    const timer = this.pendingEvals.get(conditionId);
    if (timer) {
      clearTimeout(timer);
      this.pendingEvals.delete(conditionId);
    }
  }

  private handleBookUpdate(assetId: string): void {
    const conditionId = this.assetToCondition.get(assetId);
    if (!conditionId) {
      return;
    }

    if (!this.connectionManager) return;

    const book = this.connectionManager.getOrderBook(assetId);
    if (!book) return;

    const bids = book.bids ?? [];
    const asks = book.asks ?? [];

    const bestBid =
      bids.length > 0 && typeof bids[0]?.price === 'number' && bids[0].price > 0
        ? bids[0].price
        : null;
    const bestAsk =
      asks.length > 0 && typeof asks[0]?.price === 'number' && asks[0].price > 0
        ? asks[0].price
        : null;

    // Always refresh updatedAt — including empty / unilateral books — so
    // consumers do not keep a frozen bilateral snapshot during collapse.
    let spread: number | null = null;
    let midPrice: number | null = null;
    let spreadPercent: number | null = null;

    if (bestBid != null && bestAsk != null && bestBid <= bestAsk) {
      spread = bestAsk - bestBid;
      midPrice = (bestBid + bestAsk) / 2;
      spreadPercent = bestAsk > 0 ? (spread / bestAsk) * 100 : null;
    }

    const topOfBook: TopOfBook = {
      assetId,
      bid: bestBid,
      ask: bestAsk,
      spread,
      midPrice,
      spreadPercent,
      updatedAt: Date.now(),
    };

    this.topOfBook.set(assetId, topOfBook);

    if (midPrice != null) {
      this.midHistory.record(assetId, midPrice, topOfBook.updatedAt);
    }

    const lastTime = this.lastEval.get(conditionId) ?? 0;
    const now = Date.now();
    if (now - lastTime < this.debounceMs) {
      this.scheduleEvaluation(conditionId, assetId);
      return;
    }

    this.triggerEvaluation(conditionId, assetId);
  }

  private handleMarketResolved(conditionId: string): void {
    log.info({ conditionId }, 'market resolved event received');
    this.onMarketResolved?.(conditionId);
  }

  private scheduleEvaluation(conditionId: string, assetId: string): void {
    const existing = this.pendingEvals.get(conditionId);
    if (existing) {
      clearTimeout(existing);
    }

    const timer = setTimeout(() => {
      this.pendingEvals.delete(conditionId);
      this.triggerEvaluation(conditionId, assetId);
    }, this.debounceMs);

    this.pendingEvals.set(conditionId, timer);
  }

  private triggerEvaluation(conditionId: string, assetId: string): void {
    this.lastEval.set(conditionId, Date.now());
    this.onPriceUpdate?.(conditionId, assetId);
  }
}
