import type { MarketPercentUpdate } from '@polywatch/core';
import pino from 'pino';
import type { PolymarketConnectionManager } from '../../polymarket/connection-manager.js';
import { postBackendJson } from '../../backend-client.js';

const log = pino({ name: 'market-percent-publisher' });

/**
 * Minimum relative price change that justifies emitting a percent update.
 * Polymarket prices move in 0.001 increments, so 0.0005 captures any visible
 * change while skipping noise below the human-readable percent precision.
 */
const MIN_PERCENT_CHANGE = 0.0005;

/** Maximum number of updates held before we flush immediately. */
const BATCH_MAX_SIZE = 50;

/** Maximum age of the oldest buffered update before we flush. */
const BATCH_FLUSH_MS = 250;

/**
 * Publishes live Up/Down percent updates for browse-grid markets.
 *
 * The worker subscribes to the Yes/No token order books of every active crypto
 * Up/Down market. Each book update is turned into a percent update using the
 * mid-price of the best bid/ask, then pushed to the backend so it can be
 * broadcast to frontend clients over Socket.IO.
 *
 * Updates are batched and deduplicated by assetId to avoid flooding the backend
 * with HTTP requests on every book tick.
 */
export class MarketPercentPublisher {
  private lastPrice = new Map<string, number>();
  private pending = new Map<string, MarketPercentUpdate>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly connectionManager: PolymarketConnectionManager) {}

  handleBookUpdate(assetId: string): void {
    const update = this.connectionManager
      .getMetricsCache()
      .toMarketPercentUpdate(assetId);
    if (!update) {
      log.trace({ assetId }, 'no percent update for book update');
      return;
    }

    const outcome = update.outcomePrices[0];
    if (!outcome) return;

    const last = this.lastPrice.get(assetId);
    if (last !== undefined && Math.abs(last - outcome.price) < MIN_PERCENT_CHANGE) {
      log.trace({ assetId, price: outcome.price }, 'percent unchanged, skipping push');
      return;
    }

    this.lastPrice.set(assetId, outcome.price);

    const normalizedUpdate: MarketPercentUpdate = {
      ...update,
      outcomePrices: update.outcomePrices.map((p) => ({
        outcome: p.outcome.toLowerCase(),
        price: p.price,
      })),
    };

    log.debug(
      { assetId, conditionId: normalizedUpdate.conditionId, outcome: outcome.outcome, price: outcome.price },
      'buffering live percent update',
    );

    this.pending.set(assetId, normalizedUpdate);
    if (this.pending.size >= BATCH_MAX_SIZE) {
      void this.flush();
      return;
    }
    this.scheduleFlush();
  }

  async flush(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.pending.size === 0) return;

    const updates = [...this.pending.values()];
    this.pending.clear();
    await this.pushUpdates(updates);
  }

  async pushUpdates(updates: MarketPercentUpdate[]): Promise<void> {
    if (updates.length === 0) return;
    try {
      await postBackendJson('/api/internal/market-pct-updates', { updates });
    } catch (err) {
      log.warn({ err, count: updates.length }, 'market percent batch push failed');
    }
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, BATCH_FLUSH_MS);
  }
}
