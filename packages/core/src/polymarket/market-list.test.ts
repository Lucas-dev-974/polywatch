import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchGammaMarketsKeyset, isMarketActive, resolveMarketStartDate } from './market-list.js';
import type { MarketListItemDto } from './market-list.js';
import { MarketType } from '../market/market-type.js';

function makeItem(overrides: Partial<MarketListItemDto> = {}): MarketListItemDto {
  return {
    conditionId: '0xabc',
    question: 'Bitcoin Up or Down - June 25, 4:50AM-4:55AM',
    slug: 'test',
    eventSlug: 'test-event',
    icon: null,
    endDate: new Date(Date.now() + 300_000).toISOString(),
    startDate: new Date(Date.now() - 60_000).toISOString(),
    volume: 1000,
    volume24hr: 500,
    liquidityClob: 200,
    outcomePrices: [{ outcome: 'Up', price: 0.5 }, { outcome: 'Down', price: 0.5 }],
    outcomes: [
      { label: 'Up', tokenId: '0x1', side: 0 },
      { label: 'Down', tokenId: '0x2', side: 1 },
    ],
    acceptingOrders: true,
    closed: false,
    url: 'https://polymarket.com/event/test',
    tokenIdYes: '0x1',
    tokenIdNo: '0x2',
    category: 'cryptocurrency',
    tagSlugs: ['crypto', '5M'],
    cryptoSymbol: 'Bitcoin',
    interval: '5m',
    cryptoCategory: 'up-down',
    marketType: MarketType.CRYPTO_UP_DOWN,
    ...overrides,
  };
}

describe('isMarketActive', () => {
  it('returns true for a live market', () => {
    expect(isMarketActive(makeItem())).toBe(true);
  });

  it('returns false for a closed market', () => {
    expect(isMarketActive(makeItem({ closed: true }))).toBe(false);
  });

  it('returns false when acceptingOrders is false', () => {
    expect(isMarketActive(makeItem({ acceptingOrders: false }))).toBe(false);
  });

  it('returns false when endDate is in the past', () => {
    expect(
      isMarketActive(makeItem({ endDate: new Date(Date.now() - 60_000).toISOString() })),
    ).toBe(false);
  });

  it('returns false when startDate is in the future (market not started)', () => {
    expect(
      isMarketActive(makeItem({ startDate: new Date(Date.now() + 300_000).toISOString() })),
    ).toBe(false);
  });

  it('returns true when startDate is null (no start constraint)', () => {
    expect(isMarketActive(makeItem({ startDate: null }))).toBe(true);
  });
});

describe('resolveMarketStartDate', () => {
  it('prefers eventStartTime over question parsing', () => {
    expect(
      resolveMarketStartDate(
        '2026-06-26T03:10:00.000Z',
        'Bitcoin Up or Down - June 25, 11:10PM-11:15PM ET',
      ),
    ).toBe('2026-06-26T03:10:00.000Z');
  });

  it('falls back to question parsing when eventStartTime is absent', () => {
    const parsed = resolveMarketStartDate(
      null,
      'Bitcoin Up or Down - June 25, 11:10AM-11:15AM ET',
    );
    expect(parsed).toMatch(/T15:10:00/);
  });
});

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    json: async () => body,
  } as Response;
}

describe('fetchGammaMarketsKeyset', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('maps gamma keyset markets and propagates next_cursor', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          markets: [
            {
              conditionId: '0xabc',
              question: 'Will it rain?',
              slug: 'will-it-rain',
              events: [{ slug: 'weather-2026' }],
              clobTokenIds: '["111","222"]',
              outcomes: '["Yes","No"]',
              outcomePrices: '["0.62","0.38"]',
              volume24hr: 125000,
              volumeNum: 5000000,
              liquidityClob: 45000,
              endDate: '2026-12-31T00:00:00Z',
              acceptingOrders: true,
              closed: false,
            },
          ],
          next_cursor: 'cursor-page-2',
        }),
      ),
    );

    const result = await fetchGammaMarketsKeyset({
      limit: 25,
      order: 'volume24hr',
      ascending: false,
    });

    expect(result.nextCursor).toBe('cursor-page-2');
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      conditionId: '0xabc',
      question: 'Will it rain?',
      slug: 'will-it-rain',
      eventSlug: 'weather-2026',
      volume24hr: 125000,
      volume: 5000000,
      liquidityClob: 45000,
      tokenIdYes: '111',
      url: 'https://polymarket.com/event/weather-2026',
      closed: false,
      acceptingOrders: true,
    });
    expect(result.items[0]?.outcomePrices).toEqual([
      { outcome: 'Yes', price: 0.62 },
      { outcome: 'No', price: 0.38 },
    ]);
    expect(result.items[0]?.outcomes).toEqual([
      { label: 'Yes', tokenId: '111', side: 0 },
      { label: 'No', tokenId: '222', side: 1 },
    ]);

    expect(fetch).toHaveBeenCalledWith(
      'https://gamma-api.polymarket.com/markets/keyset?limit=25&closed=false&order=volume24hr&ascending=false',
    );
  });

  it('passes after_cursor for subsequent pages', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          markets: [],
          next_cursor: undefined,
        }),
      ),
    );

    await fetchGammaMarketsKeyset({
      afterCursor: 'cursor-page-2',
      closed: false,
    });

    expect(fetch).toHaveBeenCalledWith(
      'https://gamma-api.polymarket.com/markets/keyset?limit=25&closed=false&after_cursor=cursor-page-2',
    );
  });

  it('passes tag_id and related_tags when filtering by tag', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          markets: [],
        }),
      ),
    );

    await fetchGammaMarketsKeyset({ tagId: '2' });

    expect(fetch).toHaveBeenCalledWith(
      'https://gamma-api.polymarket.com/markets/keyset?limit=25&closed=false&tag_id=2&related_tags=true',
    );
  });

  it('throws when gamma returns a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, false)));

    await expect(fetchGammaMarketsKeyset()).rejects.toThrow(
      'gamma_markets_keyset_error',
    );
  });
});
