import WebSocket from 'ws';
import type { OrderBook, OrderBookLevel } from '@polywatch/core';
import pino from 'pino';
import type { PolymarketConnectionConfig } from './connection-config.js';
import { fetchOrderBook } from './api-client.js';
import type { MarketMetricsCache } from './market-metrics-cache.js';
import {
  WS_HEARTBEAT_INTERVAL_MS,
  WS_MAX_RECONNECT_ATTEMPTS,
  WS_BASE_RECONNECT_DELAY_MS,
} from './websocket-constants.js';

const log = pino({ name: 'websocket-book' });

/**
 * Live order-book delta stream via Polymarket CLOB WebSocket.
 */
export class PolymarketBookWebSocket {
  private ws: WebSocket | null = null;
  private books = new Map<string, OrderBook>();
  private subscribedAssets = new Set<string>();
  private healthy = false;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private onBookUpdate?: (assetId: string) => void;
  private onMarketResolved?: (conditionId: string) => void;
  private onReconnect?: () => void;
  private hasConnectedOnce = false;
  private metricsCache: MarketMetricsCache | null = null;
  private readonly config: PolymarketConnectionConfig;

  constructor(config: PolymarketConnectionConfig) {
    this.config = config;
  }

  setMetricsCache(cache: MarketMetricsCache): void {
    this.metricsCache = cache;
  }

  setOnBookUpdate(cb: (assetId: string) => void): void {
    this.onBookUpdate = cb;
  }

  setOnMarketResolved(cb: (conditionId: string) => void): void {
    this.onMarketResolved = cb;
  }

  setOnReconnect(cb: () => void): void {
    this.onReconnect = cb;
  }

  isHealthy(): boolean {
    return this.healthy;
  }

  getBook(assetId: string): OrderBook | undefined {
    return this.books.get(assetId);
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        log.info({ wsUrl: this.config.wsUrl }, 'connecting to polymarket ws');
        this.ws = new WebSocket(this.config.wsUrl, {
          perMessageDeflate: {
            zlibDeflateOptions: { level: 6 },
            zlibInflateOptions: { chunkSize: 1024 },
          },
        });

        this.ws.on('open', () => {
          log.info('polymarket ws connected');
          const isReconnect = this.hasConnectedOnce;
          this.hasConnectedOnce = true;
          this.healthy = true;
          this.reconnectAttempts = 0;
          this.startHeartbeat();
          if (isReconnect) {
            try {
              this.onReconnect?.();
            } catch (err) {
              log.warn({ err }, 'onReconnect callback failed');
            }
          }
          this.sendInitialSubscription();
          resolve();
        });

        this.ws.on('message', (raw: Buffer) => {
          this.handleMessage(raw);
        });

        this.ws.on('close', (code: number, reason: Buffer) => {
          log.warn({ code, reason: reason.toString() }, 'polymarket ws closed');
          this.healthy = false;
          this.stopHeartbeat();
          this.scheduleReconnect();
        });

        this.ws.on('error', (err) => {
          log.warn({ err }, 'polymarket ws error');
          this.healthy = false;
        });
      } catch (err) {
        log.error({ err }, 'polymarket ws connect failed');
        this.healthy = false;
        this.scheduleReconnect();
        reject(err);
      }
    });
  }

  disconnect(): void {
    this.stopHeartbeat();
    this.cancelReconnect();
    this.healthy = false;
    if (this.ws) {
      this.ws.close(1000, 'shutdown');
      this.ws = null;
    }
  }

  async subscribe(assetId: string): Promise<void> {
    if (this.subscribedAssets.has(assetId)) return;

    try {
      const data = await fetchOrderBook(this.config.clobApi, assetId);
      this.storeBook(assetId, data.bids, data.asks);
      this.subscribedAssets.add(assetId);
      log.info(
        { assetId, bids: data.bids.length, asks: data.asks.length },
        'initial book snapshot loaded',
      );

      if (this.ws?.readyState === WebSocket.OPEN) {
        this.sendSubscribe(assetId);
      }
    } catch (err) {
      log.warn({ err, assetId }, 'initial book snapshot fetch failed; not subscribing');
    }
  }

  unsubscribe(assetId: string): void {
    if (!this.subscribedAssets.has(assetId)) return;

    this.subscribedAssets.delete(assetId);
    this.books.delete(assetId);
    this.metricsCache?.delete(assetId);

    if (this.ws?.readyState === WebSocket.OPEN) {
      this.sendUnsubscribe(assetId);
    }
  }

  reconcile(activeAssetIds: string[]): void {
    const activeSet = new Set(activeAssetIds);

    for (const assetId of Array.from(this.subscribedAssets)) {
      if (!activeSet.has(assetId)) {
        this.unsubscribe(assetId);
      }
    }

    for (const assetId of activeAssetIds) {
      if (!this.subscribedAssets.has(assetId)) {
        void this.subscribe(assetId);
      }
    }
  }

  async syncAll(): Promise<void> {
    const assets = Array.from(this.subscribedAssets);
    for (const assetId of assets) {
      try {
        const data = await fetchOrderBook(this.config.clobApi, assetId);
        this.storeBook(assetId, data.bids, data.asks);
      } catch (err) {
        log.warn({ err, assetId }, 'book sync fetch failed');
      }
    }
  }

  private sendSubscribe(assetId: string): void {
    this.sendMarketSubscribe([assetId]);
    log.debug({ assetId }, 'subscribed to market channel');
  }

  private sendInitialSubscription(): void {
    if (this.subscribedAssets.size === 0) return;

    const assets = Array.from(this.subscribedAssets);
    const BATCH_SIZE = 100;

    for (let i = 0; i < assets.length; i += BATCH_SIZE) {
      const batch = assets.slice(i, i + BATCH_SIZE);
      this.sendMarketSubscribe(batch);
    }

    log.info(
      { count: assets.length, batchSize: BATCH_SIZE },
      'initial market channel subscriptions sent in batches',
    );
  }

  private sendMarketSubscribe(assetIds: string[]): void {
    this.send({
      type: 'market',
      assets_ids: assetIds,
      operation: 'subscribe',
      custom_feature_enabled: true,
    });
  }

  private sendUnsubscribe(assetId: string): void {
    this.send({
      assets_ids: [assetId],
      operation: 'unsubscribe',
    });
    log.debug({ assetId }, 'unsubscribed from market channel');
  }

  private send(data: unknown): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(data));
  }

  private handleMessage(raw: Buffer): void {
    const text = raw.toString();
    if (text === 'PONG') return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return;
    }

    const events = (Array.isArray(parsed) ? parsed : [parsed]) as Array<{
      event_type?: string;
    }>;
    for (const msg of events) {
      const eventType = msg?.event_type;
      if (!eventType) continue;

      if (eventType === 'book') {
        this.handleBookSnapshot(msg as PolymarketBookEvent);
      } else if (eventType === 'price_change') {
        this.handlePriceChange(msg as PolymarketPriceChangeEvent);
      } else if (eventType === 'best_bid_ask') {
        this.handleBestBidAsk(msg as PolymarketBestBidAskEvent);
      } else if (eventType === 'last_trade_price') {
        this.handleLastTradePrice(msg as PolymarketLastTradeEvent);
      } else if (eventType === 'market_resolved') {
        this.handleMarketResolved(msg as PolymarketMarketResolvedEvent);
      }
    }
  }

  private handleBookSnapshot(msg: PolymarketBookEvent): void {
    const assetId = msg.asset_id;
    if (!assetId) return;
    this.storeBook(assetId, msg.bids ?? [], msg.asks ?? []);
    if (msg.market) {
      this.metricsCache?.setConditionId(assetId, msg.market);
    }
  }

  private handlePriceChange(msg: PolymarketPriceChangeEvent): void {
    const touched = new Set<string>();

    for (const change of msg.price_changes ?? []) {
      const assetId = change.asset_id;
      if (!assetId || !this.subscribedAssets.has(assetId)) continue;

      const book = this.books.get(assetId);
      if (!book) continue;

      const price = Number(change.price);
      const size = Number(change.size);
      if (!(price > 0)) continue;

      if (change.side === 'BUY') {
        book.bids = applyChange(book.bids, price, size);
        book.bids.sort((a, b) => b.price - a.price);
      } else if (change.side === 'SELL') {
        book.asks = applyChange(book.asks, price, size);
        book.asks.sort((a, b) => a.price - b.price);
      }
      book.updatedAt = new Date();
      touched.add(assetId);

      const bestBid = Number(change.best_bid);
      const bestAsk = Number(change.best_ask);
      if (bestBid > 0 || bestAsk > 0) {
        this.metricsCache?.updateTopOfBook(
          assetId,
          bestBid > 0 ? bestBid : 0,
          bestAsk > 0 ? bestAsk : 0,
          bestBid > 0 && bestAsk > 0 ? bestAsk - bestBid : 0,
        );
      }
    }

    if (msg.market) {
      for (const assetId of Array.from(touched)) {
        this.metricsCache?.setConditionId(assetId, msg.market!);
      }
    }

    for (const assetId of Array.from(touched)) {
      this.onBookUpdate?.(assetId);
    }
  }

  private handleBestBidAsk(msg: PolymarketBestBidAskEvent): void {
    const assetId = msg.asset_id;
    if (!assetId || !this.subscribedAssets.has(assetId)) return;

    const bestBid = Number(msg.best_bid);
    const bestAsk = Number(msg.best_ask);
    const spread = Number(msg.spread);
    if (bestBid > 0 || bestAsk > 0) {
      this.metricsCache?.updateTopOfBook(
        assetId,
        bestBid > 0 ? bestBid : 0,
        bestAsk > 0 ? bestAsk : 0,
        Number.isFinite(spread) && spread >= 0
          ? spread
          : bestBid > 0 && bestAsk > 0
            ? bestAsk - bestBid
            : 0,
      );
    }
    if (msg.market) {
      this.metricsCache?.setConditionId(assetId, msg.market);
    }
    this.onBookUpdate?.(assetId);
  }

  private handleLastTradePrice(msg: PolymarketLastTradeEvent): void {
    const assetId = msg.asset_id;
    if (!assetId || !this.subscribedAssets.has(assetId)) return;

    const price = Number(msg.price);
    const size = Number(msg.size);
    if (!(price > 0)) return;

    this.metricsCache?.updateLastTrade(
      assetId,
      price,
      size > 0 ? size : 0,
      String(msg.timestamp ?? Date.now()),
    );
    if (msg.market) {
      this.metricsCache?.setConditionId(assetId, msg.market);
    }
    this.onBookUpdate?.(assetId);
  }

  private handleMarketResolved(msg: PolymarketMarketResolvedEvent): void {
    const conditionId = msg.market ?? msg.condition_id;
    if (!conditionId) return;
    log.info({ conditionId }, 'market_resolved ws event');
    this.onMarketResolved?.(conditionId);
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send('PING');
      }
    }, WS_HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;

    const delay = WS_BASE_RECONNECT_DELAY_MS * Math.pow(2, this.reconnectAttempts);
    this.reconnectAttempts++;
    log.info({ attempt: this.reconnectAttempts, delayMs: delay }, 'scheduling ws reconnect');

    if (this.reconnectAttempts > WS_MAX_RECONNECT_ATTEMPTS) {
      log.warn(
        { attempt: this.reconnectAttempts, threshold: WS_MAX_RECONNECT_ATTEMPTS },
        'ws reconnect exceeded threshold — continuing indefinitely with backoff',
      );
    }

    const cappedDelay = Math.min(delay, 300_000);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect().catch((err) => {
        log.warn({ err }, 'reconnect failed');
      });
    }, cappedDelay);
  }

  private cancelReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private storeBook(
    assetId: string,
    bids: OrderBookLevel[] | unknown[],
    asks: OrderBookLevel[] | unknown[],
  ): void {
    if (!this.subscribedAssets.has(assetId)) return;

    const normalized = normalizeBookLevels(bids, asks);
    this.books.set(assetId, {
      assetId,
      ...normalized,
      updatedAt: new Date(),
    });
    this.onBookUpdate?.(assetId);
  }
}

interface PolymarketBookEvent {
  asset_id?: string;
  market?: string;
  bids?: unknown[];
  asks?: unknown[];
}

interface PolymarketPriceChange {
  asset_id?: string;
  price?: string | number;
  size?: string | number;
  side?: string;
  best_bid?: string | number;
  best_ask?: string | number;
}

interface PolymarketPriceChangeEvent {
  market?: string;
  price_changes?: PolymarketPriceChange[];
}

interface PolymarketBestBidAskEvent {
  asset_id?: string;
  market?: string;
  best_bid?: string | number;
  best_ask?: string | number;
  spread?: string | number;
}

interface PolymarketLastTradeEvent {
  asset_id?: string;
  market?: string;
  price?: string | number;
  size?: string | number;
  timestamp?: string | number;
}

interface PolymarketMarketResolvedEvent {
  market?: string;
  condition_id?: string;
}

function normalizeBookLevels(
  bids: OrderBookLevel[] | unknown[],
  asks: OrderBookLevel[] | unknown[],
): Pick<OrderBook, 'bids' | 'asks'> {
  const normalizedBids = parseLevels(bids).filter((l) => l.size > 0);
  const normalizedAsks = parseLevels(asks).filter((l) => l.size > 0);
  normalizedBids.sort((a, b) => b.price - a.price);
  normalizedAsks.sort((a, b) => a.price - b.price);
  return { bids: normalizedBids, asks: normalizedAsks };
}

function parseLevels(levels: unknown[]): OrderBookLevel[] {
  return levels.map((l) => {
    if (Array.isArray(l)) {
      return { price: Number(l[0]), size: Number(l[1]) };
    }
    const row = l as Record<string, unknown>;
    return {
      price: Number(row.price ?? row[0]),
      size: Number(row.size ?? row[1]),
    };
  });
}

function applyChange(
  levels: OrderBookLevel[],
  price: number,
  size: number,
): OrderBookLevel[] {
  const index = levels.findIndex((l) => Math.abs(l.price - price) < 1e-12);
  if (index >= 0) {
    if (size > 0) {
      levels[index] = { price, size };
    } else {
      levels.splice(index, 1);
    }
  } else if (size > 0) {
    levels.push({ price, size });
    levels.sort((a, b) => b.price - a.price);
  }
  return levels;
}