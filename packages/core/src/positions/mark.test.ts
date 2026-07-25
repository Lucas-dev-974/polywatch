import { describe, expect, it } from 'vitest';
import {
  computePositionUnrealizedPnl,
  getPositionMarkPrice,
  sumOpenPositionsValue,
} from './mark.js';
import type { MarketLifecycleState } from '../market/lifecycle.js';

const basePosition = {
  assetId: '111',
  conditionId: '0xabc',
  entryPrice: 0.4,
  entryBidVwap: 0.4,
  executableBidVwap: 0.55,
  quantity: 10,
};

describe('getPositionMarkPrice', () => {
  it('uses live book bid when available', () => {
    expect(getPositionMarkPrice(basePosition, 0.62, null)).toBe(0.62);
  });

  it('marks resolved winners at 1 and losers at 0', () => {
    const settled: MarketLifecycleState = {
      resolved: true,
      winningTokenId: '111',
      closed: true,
      acceptingOrders: false,
      endDate: new Date('2020-01-01'),
    };
    expect(getPositionMarkPrice(basePosition, 0, settled)).toBe(1);
    expect(
      getPositionMarkPrice({ ...basePosition, assetId: '222' }, 0, settled),
    ).toBe(0);
  });

  it('falls back to last observed bid when expired and book is empty', () => {
    const expired: MarketLifecycleState = {
      resolved: false,
      winningTokenId: null,
      closed: false,
      acceptingOrders: false,
      endDate: new Date('2020-01-01'),
    };
    expect(
      getPositionMarkPrice(
        { ...basePosition, executableBidVwap: 0.55 },
        0,
        expired,
      ),
    ).toBe(0.55);
  });
});

describe('sumOpenPositionsValue', () => {
  it('values settled positions at redemption payoff', () => {
    const settled: MarketLifecycleState = {
      resolved: true,
      winningTokenId: '111',
      closed: true,
      acceptingOrders: false,
      endDate: new Date('2020-01-01'),
    };
    const total = sumOpenPositionsValue(
      [basePosition],
      new Map([['0xabc', settled]]),
    );
    expect(total).toBe(10);
  });
});

describe('computePositionUnrealizedPnl', () => {
  it('uses current entry economics with the persisted mark', () => {
    const pnl = computePositionUnrealizedPnl({
      assetId: '111',
      executableBidVwap: 0.55,
      entryBidVwap: 0.5,
      entryPrice: 0.52,
      quantity: 10,
      entryFeesRemaining: 0.2,
    });
    expect(pnl).toBeCloseTo(0.1, 4);
  });
});
