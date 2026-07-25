import { computeTopOfBook, type CopiedPosition, type MarketTick } from '@polywatch/core';
import pino from 'pino';
import type { PolymarketConnectionManager } from '../../polymarket/connection-manager.js';
import type { OpenPositionTracker } from './open-position-tracker.js';
import {
  MarketPositionTickService,
  type RecordMarketTickInput,
} from '@polywatch/core';
import { config } from '../../config.js';

const log = pino({ name: 'market-tick-recorder' });

/**
 * Records market ticks to the DB each time a book update is received for an asset
 * that has at least one tracked position. One row is persisted per tracked position
 * on that asset.
 */
export class MarketTickRecorder {
  private lastTick = new Map<string, number>();

  constructor(
    private readonly connectionManager: PolymarketConnectionManager,
    private readonly tracker: OpenPositionTracker,
    private readonly tickService: MarketPositionTickService,
  ) {}

  handleBookUpdate(assetId: string): void {
    const now = Date.now();
    if (!this.shouldRecord(assetId, now)) return;

    const positions = this.tracker.getPositions(assetId);
    if (positions.length === 0) return;

    const marketTick = this.buildMarketTick(assetId);
    if (!marketTick) return;

    const vwap = this.connectionManager.getExecutablePrices(assetId, config.marketTickRefQty);

    const bestBid = marketTick.bestBid ?? 0;
    const bestAsk = marketTick.bestAsk ?? 0;
    if (!(bestBid > 0) && !(bestAsk > 0)) {
      log.debug({ assetId }, 'skipping market tick persistence — empty book');
      return;
    }

    const midPrice = this.computeMid(bestBid, bestAsk) ?? 0;
    const spread = this.computeSpread(bestBid, bestAsk) ?? 0;
    const spreadPercent = midPrice > 0 ? spread / midPrice : 0;

    const rows: RecordMarketTickInput[] = [];
    for (const pos of positions) {
      rows.push({
        copiedPositionId: pos.id,
        conditionId: pos.conditionId,
        assetId,
        outcome: pos.outcome,
        bestBid,
        bestAsk,
        midPrice,
        spread,
        spreadPercent,
        executableBidVwap: vwap.executableBidVwap,
        executableAskVwap: vwap.executableAskVwap,
        lastTradePrice: marketTick.lastTradePrice ?? null,
      });
    }

    this.markTickRecorded(assetId, now);

    void this.tickService.recordBatch(rows).catch((err: unknown) => {
      log.warn({ err, assetId, count: rows.length }, 'failed to record market ticks');
    });
  }

  /**
   * Persist an immediate tick when a position opens so short-lived positions
   * still have at least one row in `market_position_ticks`.
   */
  recordPositionOpen(pos: CopiedPosition): void {
    const assetId = pos.assetId;
    const marketTick = this.buildMarketTick(assetId);
    if (!marketTick) return;

    const vwap = this.connectionManager.getExecutablePrices(assetId, pos.quantity);
    const bestBid = marketTick.bestBid ?? 0;
    const bestAsk = marketTick.bestAsk ?? 0;
    if (!(bestBid > 0) && !(bestAsk > 0)) {
      log.debug(
        { positionId: pos.id, assetId },
        'skipping open tick — empty book at position open',
      );
      return;
    }

    const midPrice = this.computeMid(bestBid, bestAsk) ?? 0;
    const spread = this.computeSpread(bestBid, bestAsk) ?? 0;
    const spreadPercent = midPrice > 0 ? spread / midPrice : 0;

    const row: RecordMarketTickInput = {
      copiedPositionId: pos.id,
      conditionId: pos.conditionId,
      assetId,
      outcome: pos.outcome,
      bestBid,
      bestAsk,
      midPrice,
      spread,
      spreadPercent,
      executableBidVwap: vwap.executableBidVwap,
      executableAskVwap: vwap.executableAskVwap,
      lastTradePrice: marketTick.lastTradePrice ?? null,
    };

    this.markTickRecorded(assetId, Date.now());

    void this.tickService.recordBatch([row]).catch((err: unknown) => {
      log.warn(
        { err, positionId: pos.id, assetId },
        'failed to record open market tick',
      );
    });
  }

  private shouldRecord(assetId: string, now: number): boolean {
    const last = this.lastTick.get(assetId) ?? 0;
    return now - last >= config.marketTickThrottleMs;
  }

  private markTickRecorded(assetId: string, now: number): void {
    this.lastTick.set(assetId, now);
  }

  private buildMarketTick(assetId: string): MarketTick | null {
    const spreadExecutable = this.connectionManager.getExecutableSpread(
      assetId,
      config.marketTickRefQty,
    );
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
      bestBid: top?.bestBid,
      bestAsk: top?.bestAsk,
      spreadTop: top?.spreadTop,
      spreadExecutable,
      updatedAt: book.updatedAt.toISOString(),
    };
  }

  private computeMid(bestBid?: number, bestAsk?: number): number | undefined {
    if (bestBid == null || bestAsk == null) return undefined;
    return (bestBid + bestAsk) / 2;
  }

  private computeSpread(bestBid?: number, bestAsk?: number): number | undefined {
    if (bestBid == null || bestAsk == null) return undefined;
    return bestAsk - bestBid;
  }
}
