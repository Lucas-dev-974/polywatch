import { describe, expect, it } from 'vitest';
import type { AlgoMarketPrice } from '../components/AlgoMarketCard';
import {
  filterActiveFutureMarkets,
  filterActiveLiveMarkets,
  filterInactiveLiveMarkets,
} from './algo-market-filters';

function market(
  overrides: Partial<AlgoMarketPrice> & Pick<AlgoMarketPrice, 'conditionId'>,
): AlgoMarketPrice {
  return {
    question: null,
    cryptoSymbol: 'Bitcoin',
    interval: '5m',
    slug: null,
    enabled: true,
    phase: 'live',
    upPrice: 0.5,
    downPrice: 0.5,
    volume24hr: null,
    liquidityClob: null,
    icon: null,
    startDate: null,
    endDate: null,
    resolved: false,
    closed: false,
    ...overrides,
  };
}

describe('algo-market-filters', () => {
  it('hides closed enabled live markets but keeps open ones', () => {
    const prices = [
      market({
        conditionId: 'old',
        closed: true,
        startDate: '2026-07-03T17:20:00.000Z',
      }),
      market({
        conditionId: 'current',
        closed: false,
        startDate: '2026-07-03T17:25:00.000Z',
      }),
    ];

    expect(filterActiveLiveMarkets(prices)).toHaveLength(1);
    expect(filterActiveLiveMarkets(prices)[0]?.conditionId).toBe('current');
  });

  it('keeps future markets that start exactly now (5m rollover gap)', () => {
    const now = Date.parse('2026-07-03T17:25:00.000Z');
    const prices = [
      market({
        conditionId: 'next',
        phase: 'future',
        enabled: false,
        startDate: '2026-07-03T17:25:00.000Z',
      }),
    ];

    expect(filterActiveFutureMarkets(prices, now)).toHaveLength(1);
  });

  it('routes resolved live markets to inactive', () => {
    const prices = [
      market({
        conditionId: 'resolved',
        resolved: true,
      }),
    ];

    expect(filterActiveLiveMarkets(prices)).toHaveLength(0);
    expect(filterInactiveLiveMarkets(prices)).toHaveLength(1);
  });
});
