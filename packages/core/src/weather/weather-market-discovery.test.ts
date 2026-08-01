import { describe, it, expect } from 'vitest';
import {
  formatDiscoverCityLabel,
  formatDiscoverDateLabel,
  groupMarketsByCity,
  groupMarketsByCityAndDate,
} from './weather-market-discovery.js';
import type { MarketListItemDto } from '../polymarket/market-list.js';

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
