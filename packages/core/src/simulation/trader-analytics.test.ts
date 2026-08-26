import { describe, expect, it } from 'vitest';
import type { WatchlistEntry } from '../entities/Watchlist.js';
import type { EnrichedCopiedPosition } from '../services/copied-position-presenter.js';
import {
  aggregateTraderAnalyticsTotals,
  buildTraderAnalytics,
} from './trader-analytics.js';

function watchlist(
  partial: Partial<WatchlistEntry> & Pick<WatchlistEntry, 'id' | 'traderAddress'>,
): WatchlistEntry {
  return {
    nickname: null,
    active: true,
    simEnabled: true,
    realEnabled: false,
    createdAt: new Date(),
    ...partial,
  } as WatchlistEntry;
}

function position(
  partial: Partial<EnrichedCopiedPosition> &
    Pick<EnrichedCopiedPosition, 'watchlistId' | 'status'>,
): EnrichedCopiedPosition {
  return {
    id: 1,
    conditionId: 'c1',
    assetId: 'a1',
    outcome: 'Yes',
    side: 'BUY',
    quantity: 10,
    entryPrice: 0.5,
    entryBidVwap: 0.5,
    entryFees: 0.1,
    entryQuantityRemaining: 10,
    entryFeesRemaining: 0,
    executableBidVwap: 0.55,
    unrealizedPnl: 0.5,
    realizedPnl: 0,
    peakClosurePnlPercent: null,
    closingAttemptSeq: 0,
    liquidityStatus: 'ok',
    bookUpdatedAt: null,
    trailingPercent: 10,
    trailingActivationPercent: 12,
    mode: 'sim',
    openedAt: null,
    closedAt: null,
    closeReason: null,
    closingStartedAt: null,
    increaseCount: 0,
    moveEventId: null,
    traderName: 'Alice',
    traderAddress: '0xalice',
    marketQuestion: 'Q?',
    marketUrl: null,
    marketIcon: null,
    marketEndDate: null,
    marketTagSlugs: [],
    marketResolved: false,
    marketClosed: false,
    marketAcceptingOrders: true,
    marketWinningTokenId: null,
    lastCloseError: null,
    entryQuantityFilled: null,
    entryInvestedAmount: null,
    ...partial,
  } as EnrichedCopiedPosition;
}

describe('buildTraderAnalytics', () => {
  it('aggregates pnl, roi, win rate and fees per trader', () => {
    const entries = [
      watchlist({ id: 1, traderAddress: '0xalice', nickname: 'Alice' }),
      watchlist({ id: 2, traderAddress: '0xbob', nickname: 'Bob' }),
    ];
    const positions = [
      position({
        watchlistId: 1,
        status: 'open',
        unrealizedPnl: 2,
        quantity: 10,
        entryPrice: 0.5,
        entryFees: 0.2,
      }),
      position({
        id: 2,
        watchlistId: 1,
        status: 'closed',
        unrealizedPnl: 0,
        realizedPnl: 3,
        entryInvestedAmount: 10,
        entryFees: 0.1,
        closeReason: 'TP',
        openedAt: new Date('2024-01-01T00:00:00Z'),
        closedAt: new Date('2024-01-02T00:00:00Z'),
      }),
      position({
        id: 3,
        watchlistId: 1,
        status: 'closed',
        unrealizedPnl: 0,
        realizedPnl: -1,
        entryInvestedAmount: 5,
        entryFees: 0.05,
        closeReason: 'SL',
        openedAt: new Date('2024-01-01T00:00:00Z'),
        closedAt: new Date('2024-01-01T12:00:00Z'),
      }),
    ];

    const traders = buildTraderAnalytics(entries, positions);
    const alice = traders.find((t) => t.traderAddress === '0xalice');
    const bob = traders.find((t) => t.traderAddress === '0xbob');

    expect(alice).toMatchObject({
      positionCount: 3,
      openPositionCount: 1,
      closedPositionCount: 2,
      winningClosedCount: 1,
      realizedPnl: 2,
      unrealizedPnl: 2,
      totalPnl: 4,
      investedAmount: 20,
      roiPercent: 20,
      winRatePercent: 50,
      bestClosedPnl: 3,
      worstClosedPnl: -1,
      grossWinsTotal: 3,
      grossLossesTotal: 1,
      profitFactor: 3,
      avgWinPnl: 3,
      avgLossPnl: -1,
      holdDurationSampleCount: 2,
      closeReasonBreakdown: {
        sl: 1,
        tp: 1,
        trailing: 0,
        preClose: 0,
        manual: 0,
        copyClose: 0,
        redemption: 0,
        other: 0,
      },
    });
    expect(alice?.feesTotal).toBeCloseTo(0.35);
    expect(alice?.avgHoldDurationMs).toBe(64_800_000);
    expect(bob?.positionCount).toBe(0);
    expect(bob?.totalPnl).toBe(0);

    const totals = aggregateTraderAnalyticsTotals(traders.filter((t) => t.inWatchlistSim));
    expect(totals).toMatchObject({
      traderCount: 2,
      positionCount: 3,
      totalPnl: 4,
      profitFactor: 3,
      winRatePercent: 50,
    });
  });
});
