import { describe, expect, it } from 'vitest';
import type { EnrichedCopiedPosition } from '../services/copied-position-presenter.js';
import {
  buildPnlByMarketCategory,
  filterActiveMarketCategoryRows,
  resolveAnalyticsCategorySlug,
} from './pnl-by-category.js';
import { resolvePrimaryNavTagSlug } from '../market/nav-category.js';

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
    marketQuestion: 'Q?',
    marketUrl: null,
    marketIcon: null,
    marketEndDate: null,
    marketTagSlugs: ['sports'],
    marketCategory: null,
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

describe('resolvePrimaryNavTagSlug', () => {
  it('prefers nav slugs over leaf tags', () => {
    expect(resolvePrimaryNavTagSlug(['nba', 'sports'])).toBe('sports');
  });
});

describe('resolveAnalyticsCategorySlug', () => {
  it('maps leaf crypto tags without nav slug', () => {
    expect(resolveAnalyticsCategorySlug(['bitcoin'])).toBe('crypto');
  });

  it('uses the market category label when tags are empty', () => {
    expect(resolveAnalyticsCategorySlug([], 'Crypto')).toBe('crypto');
  });

  it('maps politics nav tags', () => {
    expect(resolveAnalyticsCategorySlug(['politics', 'trump'])).toBe('politics');
  });

  it('maps nba leaf tags to sports', () => {
    expect(resolveAnalyticsCategorySlug(['nba'])).toBe('sports');
  });

  it('infers weather from daily temperature leaf tags', () => {
    expect(
      resolveAnalyticsCategorySlug([
        'recurring',
        'daily-temperature',
        'highest-temperature',
      ]),
    ).toBe('weather');
  });

  it('infers crypto from the market question when tags are missing', () => {
    expect(
      resolveAnalyticsCategorySlug(
        [],
        null,
        'Bitcoin Up or Down - June 14, 4:15PM-4:20PM ET',
      ),
    ).toBe('crypto');
  });
});

describe('buildPnlByMarketCategory', () => {
  it('aggregates pnl into sports, esports and crypto buckets', () => {
    const rows = filterActiveMarketCategoryRows(
      buildPnlByMarketCategory([
        position({
          watchlistId: 1,
          status: 'closed',
          realizedPnl: 3,
          marketTagSlugs: ['sports', 'nba'],
        }),
        position({
          watchlistId: 1,
          status: 'open',
          unrealizedPnl: -1,
          marketTagSlugs: ['crypto'],
        }),
        position({
          watchlistId: 1,
          status: 'closed',
          realizedPnl: 5,
          marketTagSlugs: ['esports'],
        }),
        position({
          watchlistId: 1,
          status: 'closed',
          realizedPnl: 99,
          marketTagSlugs: ['politics'],
        }),
      ]),
    );

    expect(rows).toEqual([
      { slug: 'politics', label: 'Politique', pnl: 99, positionCount: 1 },
      { slug: 'sports', label: 'Sports', pnl: 3, positionCount: 1 },
      { slug: 'crypto', label: 'Crypto', pnl: -1, positionCount: 1 },
      { slug: 'esports', label: 'Esports', pnl: 5, positionCount: 1 },
    ]);
  });

  it('returns zeroed rows when no matching positions', () => {
    const rows = buildPnlByMarketCategory([]);
    expect(rows.every((row) => row.pnl === 0 && row.positionCount === 0)).toBe(
      true,
    );
  });

  it('counts crypto positions tagged with leaf slugs only', () => {
    const rows = buildPnlByMarketCategory([
      position({
        watchlistId: 1,
        status: 'closed',
        realizedPnl: 4.5,
        marketTagSlugs: ['bitcoin'],
        marketCategory: null,
      }),
    ]);

    expect(rows.find((row) => row.slug === 'crypto')).toEqual({
      slug: 'crypto',
      label: 'Crypto',
      pnl: 4.5,
      positionCount: 1,
    });
  });

  it('puts unmatched positions in the other bucket', () => {
    const rows = buildPnlByMarketCategory([
      position({
        watchlistId: 1,
        status: 'closed',
        realizedPnl: 1,
        marketTagSlugs: ['unknown-tag'],
        marketQuestion: 'Something random',
      }),
    ]);

    expect(rows.find((row) => row.slug === 'other')).toEqual({
      slug: 'other',
      label: 'Autre',
      pnl: 1,
      positionCount: 1,
    });
  });
});
