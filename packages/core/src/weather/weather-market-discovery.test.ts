import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  formatDiscoverCityLabel,
  formatDiscoverDateLabel,
  groupMarketsByCity,
  groupMarketsByCityAndDate,
  discoverResolvedWeatherMarkets,
  discoverWeatherMarketsInRange,
  matchMarketToTargetDates,
  matchMarketToDateRange,
} from './weather-market-discovery.js';
import type { MarketListItemDto } from '../polymarket/market-list.js';

const fetchGammaMarketsByTagSlugMock = vi.hoisted(() => vi.fn());

vi.mock('../polymarket/market-list.js', async () => {
  const actual = await vi.importActual<typeof import('../polymarket/market-list.js')>(
    '../polymarket/market-list.js',
  );
  return {
    ...actual,
    fetchGammaMarketsByTagSlug: fetchGammaMarketsByTagSlugMock,
  };
});

function makeMarket(overrides: Partial<MarketListItemDto>): MarketListItemDto {
  return {
    conditionId: '0x123',
    question: null,
    slug: null,
    eventSlug: null,
    icon: null,
    endDate: null,
    startDate: null,
    volume: null,
    volume24hr: null,
    liquidityClob: null,
    outcomePrices: [],
    outcomes: [],
    acceptingOrders: null,
    closed: false,
    url: '',
    tokenIdYes: null,
    tokenIdNo: null,
    category: null,
    tagSlugs: [],
    cryptoSymbol: null,
    interval: null,
    cryptoCategory: null,
    marketType: 'standard' as any,
    ...overrides,
  };
}

describe('groupMarketsByCity', () => {
  it('groups markets by city extracted from question', () => {
    const markets = [
      makeMarket({ conditionId: '1', question: 'Will the highest temperature in Hong Kong be 31°C on July 24?' }),
      makeMarket({ conditionId: '2', question: 'Will the highest temperature in Hong Kong be 32°C on July 24?' }),
      makeMarket({ conditionId: '3', question: 'Will the highest temperature in Seattle be 70°F on July 24?' }),
    ];
    const groups = groupMarketsByCity(markets);
    expect(groups).toHaveLength(2);
    const hk = groups.find(g => g.city === 'Hong Kong')!;
    expect(hk.markets).toHaveLength(2);
    const seattle = groups.find(g => g.city === 'Seattle')!;
    expect(seattle.markets).toHaveLength(1);
  });

  it('places unparseable markets under "Autres"', () => {
    const markets = [
      makeMarket({ conditionId: '1', question: 'Some random weather question' }),
      makeMarket({ conditionId: '2', question: 'Will the highest temperature in Hong Kong be 31°C on July 24?' }),
    ];
    const groups = groupMarketsByCity(markets);
    const autres = groups.find(g => g.city === 'Autres')!;
    expect(autres.markets).toHaveLength(1);
  });

  it('sorts cities alphabetically with "Autres" last', () => {
    const markets = [
      makeMarket({ conditionId: '1', question: 'random' }),
      makeMarket({ conditionId: '2', question: 'Will the highest temperature in Seattle be 70°F on July 24?' }),
      makeMarket({ conditionId: '3', question: 'Will the highest temperature in Hong Kong be 31°C on July 24?' }),
    ];
    const groups = groupMarketsByCity(markets);
    expect(groups.map(g => g.city)).toEqual(['Hong Kong', 'Seattle', 'Autres']);
  });

  it('deduplicates cities case-insensitively', () => {
    const markets = [
      makeMarket({ conditionId: '1', question: 'Will the highest temperature in Hong Kong be 31°C on July 24?' }),
      makeMarket({ conditionId: '2', question: 'Will the highest temperature in hong kong be 32°C on July 24?' }),
    ];
    const groups = groupMarketsByCity(markets);
    expect(groups).toHaveLength(1);
    expect(groups[0].city).toBe('Hong Kong');
    expect(groups[0].markets).toHaveLength(2);
  });

  it('returns empty array for empty input', () => {
    expect(groupMarketsByCity([])).toEqual([]);
  });

  it('filters by metric when metricFilter is provided', () => {
    const markets = [
      makeMarket({ conditionId: '1', question: 'Will the highest temperature in Hong Kong be 31°C on July 24?' }),
      makeMarket({ conditionId: '2', question: 'Will the lowest temperature in Hong Kong be 20°C on July 24?' }),
      makeMarket({ conditionId: '3', question: 'Will the highest temperature in Seattle be 70°F on July 24?' }),
    ];
    const groups = groupMarketsByCity(markets, 'highest_temp');
    expect(groups).toHaveLength(2);
    const hk = groups.find(g => g.city === 'Hong Kong')!;
    expect(hk.markets).toHaveLength(1);
    expect(hk.markets[0].conditionId).toBe('1');
  });

  it('excludes unparseable markets when metricFilter is active', () => {
    const markets = [
      makeMarket({ conditionId: '1', question: 'Some random weather question' }),
      makeMarket({ conditionId: '2', question: 'Will the highest temperature in Hong Kong be 31°C on July 24?' }),
    ];
    const groups = groupMarketsByCity(markets, 'highest_temp');
    expect(groups.find(g => g.city === 'Autres')).toBeUndefined();
    expect(groups).toHaveLength(1);
    expect(groups[0].city).toBe('Hong Kong');
  });
});

describe('groupMarketsByCityAndDate', () => {
  it('nests markets as city → date → markets with server labels', () => {
    const year = new Date().getFullYear();
    const markets = [
      makeMarket({
        conditionId: '1',
        question: 'Will the highest temperature in Paris be 28°C on July 30?',
      }),
      makeMarket({
        conditionId: '2',
        question: 'Will the highest temperature in Paris be 29°C on July 30?',
      }),
      makeMarket({
        conditionId: '3',
        question: 'Will the highest temperature in Paris be 27°C on July 31?',
      }),
      makeMarket({
        conditionId: '4',
        question: 'Will the highest temperature in Seattle be 70°F on July 30?',
      }),
    ];
    const groups = groupMarketsByCityAndDate(markets, 'highest_temp');
    expect(groups.map((g) => g.city)).toEqual(['Paris', 'Seattle']);
    expect(groups[0]!.cityLabel).toBe(formatDiscoverCityLabel('Paris', 3));

    const paris = groups[0]!;
    expect(paris.dates).toHaveLength(2);
    expect(paris.dates[0]!.date).toBe(`${year}-07-30`);
    expect(paris.dates[0]!.dateLabel).toBe(
      formatDiscoverDateLabel(`${year}-07-30`, 2),
    );
    expect(paris.dates[0]!.markets.map((m) => m.conditionId)).toEqual(['1', '2']);
    expect(paris.dates[1]!.date).toBe(`${year}-07-31`);
    expect(paris.dates[1]!.markets).toHaveLength(1);
  });

  it('sorts temperature buckets ascending within a date', () => {
    const markets = [
      makeMarket({
        conditionId: 'high',
        question: 'Will the highest temperature in Paris be 32°C on July 30?',
      }),
      makeMarket({
        conditionId: 'low',
        question: 'Will the highest temperature in Paris be 28°C on July 30?',
      }),
    ];
    const groups = groupMarketsByCityAndDate(markets, 'highest_temp');
    expect(groups[0]!.dates[0]!.markets.map((m) => m.conditionId)).toEqual(['low', 'high']);
  });

  it('puts Paris first in city order', () => {
    const markets = [
      makeMarket({
        conditionId: '1',
        question: 'Will the highest temperature in Seattle be 70°F on July 30?',
      }),
      makeMarket({
        conditionId: '2',
        question: 'Will the highest temperature in Paris be 28°C on July 30?',
      }),
    ];
    const groups = groupMarketsByCityAndDate(markets, 'highest_temp');
    expect(groups.map((g) => g.city)).toEqual(['Paris', 'Seattle']);
  });
});

describe('matchMarketToTargetDates', () => {
  it('matches by parsed question dateString', () => {
    const m = makeMarket({
      conditionId: '1',
      question: 'Will the highest temperature in Paris be 28°C on August 7?',
    });
    const targetStrs = new Set(['2026-08-07', '2026-08-08']);
    const targetMonthDays = new Set(['August 7', 'August 8']);
    expect(matchMarketToTargetDates(m, targetStrs, targetMonthDays)).toBe(true);
  });

  it('matches by endDate when question dateString differs', () => {
    const m = makeMarket({
      conditionId: '1',
      question: 'Will the highest temperature in Paris be 28°C on August 7?',
      endDate: '2026-08-08T00:00:00Z',
    });
    const targetStrs = new Set(['2026-08-08']);
    const targetMonthDays = new Set(['August 8']);
    expect(matchMarketToTargetDates(m, targetStrs, targetMonthDays)).toBe(true);
  });

  it('rejects markets outside the target window', () => {
    const m = makeMarket({
      conditionId: '1',
      question: 'Will the highest temperature in Paris be 28°C on August 10?',
      endDate: '2026-08-11T00:00:00Z',
    });
    const targetStrs = new Set(['2026-08-07', '2026-08-08']);
    const targetMonthDays = new Set(['August 7', 'August 8']);
    expect(matchMarketToTargetDates(m, targetStrs, targetMonthDays)).toBe(false);
  });
});

describe('discoverResolvedWeatherMarkets', () => {
  beforeEach(() => {
    fetchGammaMarketsByTagSlugMock.mockReset();
  });

  function pastMonthDay(daysAgo: number): string {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - daysAgo);
    return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
  }

  it('fetches with closed:true and returns only past-date temperature markets', async () => {
    fetchGammaMarketsByTagSlugMock.mockResolvedValue({
      items: [
        makeMarket({
          conditionId: 'win',
          question: `Will the highest temperature in Amsterdam be 28°C on ${pastMonthDay(1)}?`,
          closed: true,
        }),
        makeMarket({
          conditionId: 'future',
          question: `Will the highest temperature in Amsterdam be 28°C on ${pastMonthDay(-3)}?`,
          closed: true,
        }),
        // Not a temperature question — filtered out.
        makeMarket({ conditionId: 'rain', question: 'Will it rain tomorrow?', closed: true }),
      ],
      nextCursor: null,
    });

    const { resolvedTemperatureMarkets } = await discoverResolvedWeatherMarkets({ lookbackDays: 2 });
    expect(fetchGammaMarketsByTagSlugMock).toHaveBeenCalledWith(
      expect.objectContaining({ tagSlug: 'weather', closed: true }),
    );
    expect(resolvedTemperatureMarkets.map((m) => m.conditionId)).toEqual(['win']);
  });

  it('handles pagination across multiple pages', async () => {
    fetchGammaMarketsByTagSlugMock
      .mockResolvedValueOnce({
        items: [
          makeMarket({
            conditionId: 'page1',
            question: `Will the highest temperature in Paris be 33°C on ${pastMonthDay(1)}?`,
            closed: true,
          }),
        ],
        nextCursor: '100',
      })
      .mockResolvedValueOnce({
        items: [],
        nextCursor: null,
      });

    const result = await discoverResolvedWeatherMarkets({ lookbackDays: 2 });
    expect(fetchGammaMarketsByTagSlugMock).toHaveBeenCalledTimes(2);
    expect(result.resolvedTemperatureMarkets.map((m) => m.conditionId)).toEqual(['page1']);
  });

  it('returns empty list when no markets match', async () => {
    fetchGammaMarketsByTagSlugMock.mockResolvedValueOnce({ items: [], nextCursor: null });
    const result = await discoverResolvedWeatherMarkets({ lookbackDays: 2 });
    expect(result.resolvedTemperatureMarkets).toEqual([]);
  });
});

describe('matchMarketToDateRange', () => {
  it('matches when target date is inside inclusive range', () => {
    const market = makeMarket({
      question: 'Will the highest temperature in Paris be 25°C on August 8?',
      endDate: '2026-08-09T00:00:00.000Z',
    });
    expect(matchMarketToDateRange(market, '2026-08-08', '2026-08-09')).toBe(true);
  });

  it('rejects when target date is outside range', () => {
    const market = makeMarket({
      question: 'Will the highest temperature in Paris be 25°C on August 8?',
      endDate: '2026-08-09T00:00:00.000Z',
    });
    expect(matchMarketToDateRange(market, '2026-08-01', '2026-08-07')).toBe(false);
  });
});

describe('discoverWeatherMarketsInRange', () => {
  beforeEach(() => {
    fetchGammaMarketsByTagSlugMock.mockReset();
  });

  it('filters by city, metric and date range across closed and open scans', async () => {
    const parisAug8 = makeMarket({
      conditionId: 'paris-8',
      question: 'Will the highest temperature in Paris be 25°C on August 8?',
      endDate: '2026-08-09T00:00:00.000Z',
      tokenIdYes: 'yes-8',
      tokenIdNo: 'no-8',
    });
    const parisAug9 = makeMarket({
      conditionId: 'paris-9',
      question: 'Will the highest temperature in Paris be 26°C on August 9?',
      endDate: '2026-08-10T00:00:00.000Z',
      tokenIdYes: 'yes-9',
      tokenIdNo: 'no-9',
    });
    const londonAug8 = makeMarket({
      conditionId: 'london-8',
      question: 'Will the highest temperature in London be 20°C on August 8?',
      endDate: '2026-08-09T00:00:00.000Z',
    });

    fetchGammaMarketsByTagSlugMock.mockImplementation(async (opts: { closed?: boolean }) => {
      if (opts.closed) {
        return { items: [parisAug8, londonAug8], nextCursor: null };
      }
      return { items: [parisAug9], nextCursor: null };
    });

    const result = await discoverWeatherMarketsInRange({
      city: 'Paris',
      from: new Date('2026-08-08T00:00:00.000Z'),
      to: new Date('2026-08-09T00:00:00.000Z'),
      metric: 'highest_temp',
    });

    expect(fetchGammaMarketsByTagSlugMock).toHaveBeenCalledTimes(2);
    expect(result.markets.map((m) => m.conditionId).sort()).toEqual(['paris-8', 'paris-9']);
    expect(result.byCity).toHaveLength(1);
    expect(result.byCity[0]!.city).toBe('Paris');
    expect(result.byCity[0]!.dates).toHaveLength(2);
  });
});
