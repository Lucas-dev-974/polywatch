import type { MarketPercentUpdate, MarketTick } from '@polywatch/core';

export interface AssetMarketMetrics {
  assetId: string;
  conditionId?: string;
  outcome?: string;
  bestBid?: number;
  bestAsk?: number;
  spreadTop?: number;
  lastTradePrice?: number;
  lastTradeSize?: number;
  lastTradeTimestamp?: string;
  updatedAt: number;
}

/**
 * In-memory WS-derived metrics per asset, separate from the order book model.
 */
export class MarketMetricsCache {
  private metrics = new Map<string, AssetMarketMetrics>();

  get(assetId: string): AssetMarketMetrics | undefined {
    return this.metrics.get(assetId);
  }

  delete(assetId: string): void {
    this.metrics.delete(assetId);
  }

  updateTopOfBook(
    assetId: string,
    bestBid: number,
    bestAsk: number,
    spreadTop: number,
  ): void {
    const row = this.ensure(assetId);
    if (bestBid > 0) row.bestBid = bestBid;
    if (bestAsk > 0) row.bestAsk = bestAsk;
    if (spreadTop >= 0) row.spreadTop = spreadTop;
    row.updatedAt = Date.now();
  }

  updateLastTrade(
    assetId: string,
    price: number,
    size: number,
    timestamp: string,
  ): void {
    const row = this.ensure(assetId);
    row.lastTradePrice = price;
    row.lastTradeSize = size;
    row.lastTradeTimestamp = timestamp;
    row.updatedAt = Date.now();
  }

  setConditionId(assetId: string, conditionId: string): void {
    this.ensure(assetId).conditionId = conditionId;
  }

  setOutcome(assetId: string, outcome: string): void {
    this.ensure(assetId).outcome = outcome.toLowerCase();
  }

  toMarketTick(
    assetId: string,
    spreadExecutable?: number,
  ): MarketTick | null {
    const row = this.metrics.get(assetId);
    if (!row) return null;
    return {
      assetId,
      conditionId: row.conditionId,
      bestBid: row.bestBid,
      bestAsk: row.bestAsk,
      spreadTop: row.spreadTop,
      spreadExecutable,
      lastTradePrice: row.lastTradePrice,
      lastTradeSize: row.lastTradeSize,
      lastTradeTimestamp: row.lastTradeTimestamp,
      updatedAt: new Date(row.updatedAt).toISOString(),
    };
  }

  /**
   * Compute a live Up/Down percent update from the best bid/ask midpoint.
   * Returns null when the asset is not mapped to a conditionId/outcome or
   * the book is empty.
   */
  toMarketPercentUpdate(assetId: string): MarketPercentUpdate | null {
    const row = this.metrics.get(assetId);
    if (!row?.conditionId || !row.outcome) return null;

    const bestBid = row.bestBid ?? 0;
    const bestAsk = row.bestAsk ?? 0;
    if (!(bestBid > 0) && !(bestAsk > 0)) return null;

    const price =
      bestBid > 0 && bestAsk > 0
        ? (bestBid + bestAsk) / 2
        : bestBid > 0
          ? bestBid
          : bestAsk;

    return {
      conditionId: row.conditionId,
      outcomePrices: [{ outcome: row.outcome, price }],
      updatedAt: new Date(row.updatedAt).toISOString(),
    };
  }

  private ensure(assetId: string): AssetMarketMetrics {
    let row = this.metrics.get(assetId);
    if (!row) {
      row = { assetId, updatedAt: Date.now() };
      this.metrics.set(assetId, row);
    }
    return row;
  }
}
