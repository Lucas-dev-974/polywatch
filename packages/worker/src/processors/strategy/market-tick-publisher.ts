import { computeTopOfBook, type MarketTick } from '@polywatch/core';
import pino from 'pino';
import type { PolymarketConnectionManager } from '../../polymarket/connection-manager.js';
import { postBackendJson } from '../../backend-client.js';
import { PNL_TICK_THROTTLE_MS } from '../../constants.js';

const log = pino({ name: 'market-tick-publisher' });

export class MarketTickPublisher {
  private lastMarketTick = new Map<string, number>();

  constructor(private readonly connectionManager: PolymarketConnectionManager) {}

  shouldEmitTick(assetId: string, now: number): boolean {
    const last = this.lastMarketTick.get(assetId) ?? 0;
    return now - last >= PNL_TICK_THROTTLE_MS;
  }

  markTickEmitted(assetId: string, now: number): void {
    this.lastMarketTick.set(assetId, now);
  }

  buildTick(
    assetId: string,
    quantity: number,
    conditionId?: string,
  ): MarketTick | null {
    if (conditionId) {
      this.connectionManager.getMetricsCache().setConditionId(assetId, conditionId);
    }
    const spreadExecutable =
      this.connectionManager.getExecutableSpread(assetId, quantity);
    const fromCache = this.connectionManager
      .getMetricsCache()
      .toMarketTick(assetId, spreadExecutable);
    if (fromCache) return fromCache;

    const book = this.connectionManager.getOrderBook(assetId);
    if (!book) return null;

    const top = computeTopOfBook(book);
    if (!top && spreadExecutable == null) return null;

    return {
      assetId,
      conditionId,
      bestBid: top?.bestBid,
      bestAsk: top?.bestAsk,
      spreadTop: top?.spreadTop,
      spreadExecutable,
      updatedAt: book.updatedAt.toISOString(),
    };
  }

  async pushTicks(ticks: MarketTick[]): Promise<void> {
    if (ticks.length === 0) return;
    try {
      await postBackendJson('/api/internal/market-ticks', { ticks });
    } catch (err) {
      log.warn({ err }, 'market tick push failed');
    }
  }
}
