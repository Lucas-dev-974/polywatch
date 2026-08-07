import type {
  ExecutablePriceResult,
  IBookWsClient,
  IPolymarketConnectionManager,
} from '@polywatch/core';

/**
 * Mock Polymarket connection manager for crypto-algo e2e tests.
 * Lets tests control executable prices and simulate WebSocket book updates.
 */
export class MockConnectionManager implements IPolymarketConnectionManager {
  private priceMap = new Map<string, ExecutablePriceResult>();
  private onBookUpdateCb?: (assetId: string) => void;
  private onMarketResolvedCb?: (conditionId: string) => void;
  private orderBooks = new Map<
    string,
    { bids: { price: number; size: number }[]; asks: { price: number; size: number }[] }
  >();
  private readonly wsClient: IBookWsClient;

  constructor() {
    this.wsClient = {
      reconcile: () => {},
      syncAll: async () => {},
      isHealthy: () => true,
      setOnMarketResolved: (cb) => {
        this.onMarketResolvedCb = cb;
      },
      disconnect: () => {},
      setOnReconnect: () => {},
    };
  }

  setPrice(assetId: string, result: ExecutablePriceResult): void {
    this.priceMap.set(assetId, result);
  }

  setOrderBook(
    assetId: string,
    bids: { price: number; size: number }[],
    asks: { price: number; size: number }[],
  ): void {
    this.orderBooks.set(assetId, { bids, asks });
  }

  async fetchExecutablePrices(
    assetId: string,
    _quantity: number,
  ): Promise<ExecutablePriceResult> {
    return this.getExecutablePrices(assetId, _quantity);
  }

  getExecutablePrices(
    assetId: string,
    _quantity: number,
  ): ExecutablePriceResult {
    const result = this.priceMap.get(assetId);
    if (!result) {
      throw new Error(`MockConnectionManager: no price set for assetId ${assetId}`);
    }
    return result;
  }

  getWsClient(): IBookWsClient {
    return this.wsClient;
  }

  setOnBookUpdate(cb: (assetId: string) => void): void {
    this.onBookUpdateCb = cb;
  }

  setOnMarketResolved(cb: (conditionId: string) => void): void {
    this.onMarketResolvedCb = cb;
  }

  getOrderBook(assetId: string):
    | { bids: { price: number; size: number }[]; asks: { price: number; size: number }[] }
    | undefined {
    return this.orderBooks.get(assetId);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getMetricsCache(): any {
    return {
      getMidPrice: () => 0.5,
      getBestBid: () => 0.49,
      getBestAsk: () => 0.51,
    };
  }

  /** Simulate a WebSocket book update for the given asset. */
  emitBookUpdate(assetId: string): void {
    this.onBookUpdateCb?.(assetId);
  }

  /** Simulate a market_resolved event. */
  emitMarketResolved(conditionId: string): void {
    this.onMarketResolvedCb?.(conditionId);
  }

  /** Worker execution-completion path stubs */
  setBrowseMarketMeta(): void {}
  reconcileActiveAssets(): void {}
}
