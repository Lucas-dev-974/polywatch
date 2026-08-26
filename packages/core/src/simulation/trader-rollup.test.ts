import { describe, expect, it } from 'vitest';
import type { WatchlistEntry } from '../entities/Watchlist.js';
import type { EnrichedCopiedPosition } from '../services/copied-position-presenter.js';
import { buildSimTraderRollup } from './trader-rollup.js';

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
    entryFees: 0,
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
    ...partial,
  } as EnrichedCopiedPosition;
}

describe('buildSimTraderRollup', () => {
  it('unions watchlist sim traders with orphan position traders', () => {
    const entries = [
      watchlist({ id: 1, traderAddress: '0xalice', nickname: 'Alice' }),
      watchlist({
        id: 2,
        traderAddress: '0xbob',
        nickname: 'Bob',
        simEnabled: true,
      }),
    ];
    const positions = [
      position({
        watchlistId: 1,
        status: 'open',
        unrealizedPnl: 2,
        realizedPnl: 0,
      }),
      position({
        id: 2,
        watchlistId: 99,
        status: 'closed',
        traderName: null,
        traderAddress: '0xorphan',
        unrealizedPnl: 0,
        realizedPnl: 3,
      }),
    ];

    const { traders, tradersLabel } = buildSimTraderRollup(entries, positions);

    expect(traders.length).toBe(3);
    const alice = traders.find((t) => t.traderAddress === '0xalice');
    expect(alice?.positionCount).toBe(1);
    expect(alice?.openPositionCount).toBe(1);
    expect(alice?.unrealizedPnl).toBe(2);

    const orphan = traders.find((t) => t.traderAddress === '0xorphan');
    expect(orphan?.inWatchlistSim).toBe(false);
    expect(orphan?.closedPositionCount).toBe(1);
    expect(orphan?.realizedPnl).toBe(3);

    const bob = traders.find((t) => t.traderAddress === '0xbob');
    expect(bob?.positionCount).toBe(0);

    expect(tradersLabel).toContain('Alice');
    expect(tradersLabel).toContain('Bob');
  });
});
