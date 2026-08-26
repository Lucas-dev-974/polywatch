import { describe, expect, it } from 'vitest';
import type { EnrichedCopiedPosition } from '../services/copied-position-presenter.js';
import type { SimSnapshotTrader } from '../types/sim-state-snapshot.js';
import {
  buildTraderPnlSeriesFromSnapshots,
  buildTraderPnlSeriesResponse,
  collectTraderMarkets,
  computeTraderPnlAtSnapshot,
  mergeTraderMarkets,
  sumTraderPnlFromPositions,
  updateLivePnlSeriesPoint,
} from './trader-pnl-series.js';

function trader(
  partial: Partial<SimSnapshotTrader> &
    Pick<SimSnapshotTrader, 'watchlistId' | 'traderAddress'>,
): SimSnapshotTrader {
  return {
    nickname: null,
    active: true,
    simEnabled: true,
    inWatchlistSim: true,
    positionCount: 0,
    openPositionCount: 0,
    closedPositionCount: 0,
    realizedPnl: 0,
    unrealizedPnl: 0,
    ...partial,
  };
}

function position(
  partial: Partial<EnrichedCopiedPosition> &
    Pick<EnrichedCopiedPosition, 'watchlistId' | 'status' | 'conditionId'>,
): EnrichedCopiedPosition {
  return {
    id: 1,
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
    unrealizedPnl: 1,
    realizedPnl: 2,
    peakClosurePnlPercent: null,
    closingAttemptSeq: 0,
    liquidityStatus: 'ok',
    bookUpdatedAt: null,
    trailingPercent: null,
    trailingActivationPercent: null,
    mode: 'sim',
    openedAt: null,
    closedAt: null,
    closeReason: null,
    closingStartedAt: null,
    increaseCount: 0,
    moveEventId: null,
    traderName: 'Alice',
    traderAddress: '0xalice',
    marketQuestion: 'Will it rain?',
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

describe('computeTraderPnlAtSnapshot', () => {
  it('uses trader rollup for all markets', () => {
    const pnl = computeTraderPnlAtSnapshot(
      {
        traders: [
          trader({
            watchlistId: 1,
            traderAddress: '0xalice',
            realizedPnl: 3,
            unrealizedPnl: 1.5,
          }),
        ],
        positions: [],
      },
      1,
    );
    expect(pnl).toBe(4.5);
  });

  it('filters by conditionId from positions', () => {
    const pnl = computeTraderPnlAtSnapshot(
      {
        traders: [],
        positions: [
          position({
            watchlistId: 1,
            conditionId: 'c1',
            status: 'closed',
            realizedPnl: 5,
          }),
          position({
            watchlistId: 1,
            conditionId: 'c2',
            status: 'open',
            unrealizedPnl: 10,
          }),
        ],
      },
      1,
      'c1',
    );
    expect(pnl).toBe(5);
  });

  it('returns 0 when trader is absent and positions empty', () => {
    expect(
      computeTraderPnlAtSnapshot({ traders: [], positions: [] }, 99),
    ).toBe(0);
  });

  it('falls back to positions when trader rollup is missing', () => {
    const pnl = computeTraderPnlAtSnapshot(
      {
        traders: [],
        positions: [
          position({
            watchlistId: 1,
            conditionId: 'c1',
            status: 'closed',
            realizedPnl: 4,
          }),
        ],
      },
      1,
    );
    expect(pnl).toBe(4);
  });
});

describe('buildTraderPnlSeriesFromSnapshots', () => {
  it('builds chronological series with live terminal point', () => {
    const result = buildTraderPnlSeriesFromSnapshots(
      [
        {
          id: 1,
          createdAt: '2026-06-20T10:00:00.000Z',
          traders: [
            trader({
              watchlistId: 1,
              traderAddress: '0xalice',
              realizedPnl: 1,
              unrealizedPnl: 0,
            }),
          ],
          positions: [
            position({
              watchlistId: 1,
              conditionId: 'c1',
              status: 'closed',
              marketQuestion: 'Market A',
            }),
          ],
        },
        {
          id: 2,
          createdAt: '2026-06-21T10:00:00.000Z',
          traders: [
            trader({
              watchlistId: 1,
              traderAddress: '0xalice',
              realizedPnl: 2,
              unrealizedPnl: 1,
            }),
          ],
          positions: [
            position({
              watchlistId: 1,
              conditionId: 'c1',
              status: 'open',
              marketQuestion: 'Market A',
            }),
          ],
        },
      ],
      {
        watchlistId: 1,
        liveTerminal: {
          at: '2026-06-21T12:00:00.000Z',
          totalPnl: 4,
        },
      },
    );

    expect(result.points).toHaveLength(3);
    expect(result.points[0]?.pnl).toBe(1);
    expect(result.points[1]?.pnl).toBe(3);
    expect(result.points[2]).toMatchObject({ pnl: 4, live: true });
    expect(result.markets).toEqual([
      { conditionId: 'c1', label: 'Market A' },
    ]);
  });

  it('deduplicates points within the same second', () => {
    const result = buildTraderPnlSeriesFromSnapshots(
      [
        {
          id: 1,
          createdAt: '2026-06-20T10:00:00.100Z',
          traders: [
            trader({
              watchlistId: 1,
              traderAddress: '0xalice',
              realizedPnl: 1,
              unrealizedPnl: 0,
            }),
          ],
          positions: [],
        },
        {
          id: 2,
          createdAt: '2026-06-20T10:00:00.900Z',
          traders: [
            trader({
              watchlistId: 1,
              traderAddress: '0xalice',
              realizedPnl: 2,
              unrealizedPnl: 0,
            }),
          ],
          positions: [],
        },
      ],
      { watchlistId: 1 },
    );

    expect(result.points).toHaveLength(1);
    expect(result.points[0]?.pnl).toBe(2);
    expect(result.points[0]?.snapshotId).toBe(2);
  });
});

describe('collectTraderMarkets / mergeTraderMarkets', () => {
  it('collects unique markets for a trader', () => {
    const markets = collectTraderMarkets(
      [
        position({ watchlistId: 1, conditionId: 'c2', status: 'open' }),
        position({ watchlistId: 1, conditionId: 'c1', status: 'closed' }),
        position({ watchlistId: 2, conditionId: 'c9', status: 'open' }),
      ],
      1,
    );
    expect(markets.map((m) => m.conditionId).sort()).toEqual(['c1', 'c2']);
  });

  it('merges market lists without duplicates', () => {
    const merged = mergeTraderMarkets(
      [{ conditionId: 'c1', label: 'A' }],
      [{ conditionId: 'c2', label: 'B' }, { conditionId: 'c1', label: 'A2' }],
    );
    expect(merged).toHaveLength(2);
    expect(merged[0]?.conditionId).toBe('c1');
  });
});

describe('updateLivePnlSeriesPoint', () => {
  it('appends or updates the live terminal point', () => {
    const base = [
      { t: '2026-06-21T10:00:00.000Z', pnl: 1, snapshotId: 1 },
    ];
    const appended = updateLivePnlSeriesPoint(base, 2);
    expect(appended).toHaveLength(2);
    expect(appended[1]).toMatchObject({ pnl: 2, live: true });

    const updated = updateLivePnlSeriesPoint(appended, 3);
    expect(updated).toHaveLength(2);
    expect(updated[1]).toMatchObject({ pnl: 3, live: true });
  });
});

describe('buildTraderPnlSeriesResponse', () => {
  it('builds series, markets and live total from positions', () => {
    const result = buildTraderPnlSeriesResponse({
      snapshots: [
        {
          id: 1,
          createdAt: '2026-06-20T10:00:00.000Z',
          traders: [
            trader({
              watchlistId: 1,
              traderAddress: '0xalice',
              realizedPnl: 1,
              unrealizedPnl: 0,
            }),
          ],
          positions: [],
        },
      ],
      watchlistId: 1,
      livePositions: [
        position({
          watchlistId: 1,
          conditionId: 'c1',
          status: 'open',
          unrealizedPnl: 2,
          marketQuestion: 'Market A',
        }),
      ],
      liveAt: '2026-06-21T12:00:00.000Z',
    });

    expect(result.currentTotalPnl).toBe(2);
    expect(result.points.at(-1)).toMatchObject({ pnl: 2, live: true });
    expect(result.markets).toEqual([
      { conditionId: 'c1', label: 'Market A' },
    ]);
  });
});
