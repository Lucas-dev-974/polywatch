import { describe, it, expect } from 'vitest';
import { groupMarketsByCity } from './weather-market-discovery.js';
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
