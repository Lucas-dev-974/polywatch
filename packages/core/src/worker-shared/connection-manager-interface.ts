/**
 * Type-only interface for the Polymarket connection manager.
 *
 * The concrete `PolymarketConnectionManager` implementation lives in
 * `@polywatch/worker` and carries a heavy dependency chain (websocket-book,
 * websocket-user, market-metrics-cache, circuit-breaker, rate-limited-fetch,
 * token-bucket, pending-move-assets). Rather than extracting that entire
 * chain, we export only the interface here so that future packages such as
 * crypto-algo can depend on the contract without pulling in the worker
 * implementation.
 */

/**
 * Executable prices returned by the connection manager.
 * Mirrors the shape returned by `PolymarketConnectionManager.fetchExecutablePrices`.
 */
export interface ExecutablePriceResult {
  executableBidVwap: number;
  executableAskVwap: number;
  /** Bid-side walk status (legacy field used by exit/monitoring paths). */
  liquidityStatus: 'ok' | 'partial' | 'illiquid';
  /** Ask-side walk status for entry depth checks. */
  askLiquidityStatus?: 'ok' | 'partial' | 'illiquid';
}

/**
 * Minimal WebSocket book client surface exposed via the connection manager.
 * crypto-algo only needs a subset of the book WS client methods.
 */
export interface IBookWsClient {
  reconcile(assetIds: string[]): void;
  syncAll(): Promise<void>;
  isHealthy(): boolean;
  setOnMarketResolved(cb: (conditionId: string) => void): void;
}

/**
 * Contract that crypto-algo (and other future packages) can depend on
 * without importing the worker implementation.
 */
export interface IPolymarketConnectionManager {
  /** Sync executable bid/ask VWAP from the in-memory book cache. */
  getExecutablePrices(
    assetId: string,
    quantity: number,
  ): ExecutablePriceResult;

  /** Fetch executable bid/ask VWAP prices for an asset at a given quantity. */
  fetchExecutablePrices(
    assetId: string,
    quantity: number,
  ): Promise<ExecutablePriceResult>;

  /** Force-refresh the order book from REST (optional, used for entry depth retries). */
  forceRefreshBook?(assetId: string): Promise<unknown>;

  /** Expose the underlying WebSocket book client for lifecycle management. */
  getWsClient(): IBookWsClient;

  /** Register a callback fired on each book update for an asset. */
  setOnBookUpdate(cb: (assetId: string) => void): void;

  /** Register a callback fired when a market is resolved. */
  setOnMarketResolved(cb: (conditionId: string) => void): void;

  /** Get the current order book for an asset (from WebSocket cache). */
  getOrderBook(assetId: string): { bids: { price: number; size: number }[]; asks: { price: number; size: number }[] } | undefined;

  /** Get the metrics cache for computing market percent updates. */
  getMetricsCache(): import('../polymarket/market-metrics-cache.js').MarketMetricsCache;
}