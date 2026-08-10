import { describe, expect, it } from 'vitest';
import { filterMarketItems, isBinaryUpDown, mergeOutcomePrices } from './markets-list';
import { MarketType } from '@polywatch/core';
import type { MarketListItemDto } from '@polywatch/core/market-list';

describe('isBinaryUpDown', () => {
  it('detects up/down markets', () => {
    expect(
      isBinaryUpDown([
        { outcome: 'up', price: 0.31 },
        { outcome: 'down', price: 0.69 },
      ]),
    ).toBe(true);
  });

  it('detects up/down markets with mixed case', () => {
    expect(
      isBinaryUpDown([
        { outcome: 'Up', price: 0.31 },
        { outcome: 'DOWN', price: 0.69 },
      ]),
    ).toBe(true);
  });

  it('rejects yes/no markets', () => {
    expect(
      isBinaryUpDown([
        { outcome: 'yes', price: 0.6 },
        { outcome: 'no', price: 0.4 },
      ]),
    ).toBe(false);
  });

  it('rejects markets with more than two outcomes', () => {
    expect(
      isBinaryUpDown([
        { outcome: 'up', price: 0.3 },
        { outcome: 'down', price: 0.5 },
        { outcome: 'flat', price: 0.2 },
      ]),
    ).toBe(false);
  });
});

describe('mergeOutcomePrices', () => {
  it('overwrites existing prices with incoming prices', () => {
    const merged = mergeOutcomePrices(
      [
        { outcome: 'up', price: 0.31 },
        { outcome: 'down', price: 0.69 },
      ],
      [{ outcome: 'up', price: 0.42 }],
    );
    expect(merged).toEqual([
      { outcome: 'up', price: 0.42 },
      { outcome: 'down', price: 0.58 },
    ]);
  });

  it('derives the complementary price for a down update', () => {
    const merged = mergeOutcomePrices(
      [
        { outcome: 'up', price: 0.31 },
        { outcome: 'down', price: 0.69 },
      ],
      [{ outcome: 'down', price: 0.76 }],
    );
    expect(merged).toEqual([
      { outcome: 'up', price: 0.24 },
      { outcome: 'down', price: 0.76 },
    ]);
  });

  it('normalizes mismatched binary prices to sum to 1', () => {
    const merged = mergeOutcomePrices(
      [
        { outcome: 'up', price: 0.22 },
        { outcome: 'down', price: 0.78 },
      ],
      [
        { outcome: 'up', price: 0.35 },
        { outcome: 'down', price: 0.68 },
      ],
    );
    expect(merged).toEqual([
      { outcome: 'up', price: 0.35 },
      { outcome: 'down', price: 0.65 },
    ]);
  });

  it('keeps non-binary outcomes unchanged', () => {
    const merged = mergeOutcomePrices(
      [
        { outcome: 'yes', price: 0.6 },
        { outcome: 'no', price: 0.4 },
      ],
      [{ outcome: 'yes', price: 0.55 }],
    );
    expect(merged).toEqual([
      { outcome: 'yes', price: 0.55 },
      { outcome: 'no', price: 0.4 },
    ]);
  });

  it('clamps complementary prices to [0, 1]', () => {
    const merged = mergeOutcomePrices(
      [
        { outcome: 'up', price: 0.5 },
        { outcome: 'down', price: 0.5 },
      ],
      [{ outcome: 'up', price: 1.2 }],
    );
    expect(merged).toEqual([
      { outcome: 'up', price: 1 },
      { outcome: 'down', price: 0 },
    ]);
  });
});

describe('filterMarketItems', () => {
  const baseItem: MarketListItemDto = {
    conditionId: '0xabc',
    question: 'Test market',
    slug: 'test',
    eventSlug: 'test-event',
    icon: null,
    endDate: new Date(Date.now() + 300_000).toISOString(),
    startDate: new Date(Date.now() - 60_000).toISOString(),
    volume: 1000,
    volume24hr: 500,
    liquidityClob: 200,
    outcomePrices: [],
    outcomes: [],
    acceptingOrders: true,
    closed: false,
    url: 'https://polymarket.com/event/test',
    tokenIdYes: null,
    tokenIdNo: null,
    category: null,
    tagSlugs: [],
    cryptoSymbol: null,
    interval: null,
    cryptoCategory: null,
    marketType: MarketType.STANDARD,
  };

  it('filters out markets that have not started yet', () => {
    const futureItem = {
      ...baseItem,
      startDate: new Date(Date.now() + 600_000).toISOString(),
    };
    const result = filterMarketItems([futureItem], {});
    expect(result).toHaveLength(0);
  });

  it('keeps markets with null startDate', () => {
    const noStartItem = { ...baseItem, startDate: null };
    const result = filterMarketItems([noStartItem], {});
    expect(result).toHaveLength(1);
  });
});
