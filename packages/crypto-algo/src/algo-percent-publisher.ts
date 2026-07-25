import {
  createBackendClient,
  type IPolymarketConnectionManager,
  type MarketPercentUpdate,
} from '@polywatch/core';
import pino from 'pino';

const log = pino({ name: 'crypto-algo:percent-publisher' });

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
 * Publishes live Up/Down percent updates for algo markets.
 *
 * Subscribes to order book updates via the connection manager, computes
 * mid-prices, and pushes updates to the backend for WebSocket broadcast
 * to connected frontend clients.
 */
export class AlgoMarketPercentPublisher {
  private lastPrice = new Map<string, number>();
  private pending: MarketPercentUpdate[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly postBackendJson: ReturnType<
    typeof createBackendClient
  >['postBackendJson'];

  constructor(
    private readonly connectionManager: IPolymarketConnectionManager,
    backendUrl: string,
    serviceToken: string,
  ) {
    ({ postBackendJson: this.postBackendJson } = createBackendClient({
      backendUrl,
      serviceToken,
    }));
  }

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
      'buffering algo percent update',
    );

    this.pending.push(normalizedUpdate);
    if (this.pending.length >= BATCH_MAX_SIZE) {
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
    if (this.pending.length === 0) return;

    const updates = [...this.pending];
    this.pending = [];
    await this.pushUpdates(updates);
  }

  async pushUpdates(updates: MarketPercentUpdate[]): Promise<void> {
    if (updates.length === 0) return;
    try {
      const res = await this.postBackendJson('/api/internal/market-pct-updates', {
        updates,
      });
      if (!res.ok) {
        log.warn({ status: res.status, count: updates.length }, 'algo percent push failed');
        return;
      }
      log.debug({ count: updates.length }, 'pushed algo percent updates to backend');
    } catch (err) {
      log.warn({ err, count: updates.length }, 'algo percent batch push failed');
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