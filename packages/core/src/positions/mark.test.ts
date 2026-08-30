import { describe, expect, it } from 'vitest';
import {
  computeExecutableCashPnl,
  computePositionUnrealizedPnl,
  getPositionMarkPrice,
  sumOpenPositionsValue,
  unrealizedPnlEntryBasis,
} from './mark.js';
import type { MarketLifecycleState } from '../market/lifecycle.js';
import { computeSellSettlement } from '../simulation/accounting.js';

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

  it('copy/crypto keep bid vs entry ask even with a wide book', () => {
    const pnl = computePositionUnrealizedPnl({
      assetId: '111',
      reason: 'COPY_OPEN',
      executableBidVwap: 0.32,
      entryBidVwap: 0.32,
      entryPrice: 0.41,
      quantity: 10,
      entryFeesRemaining: 0.05,
    });
    expect(pnl).toBeCloseTo((0.32 - 0.41) * 10 - 0.05, 4);
  });

  it('weather t0: bid == entryBid → uPnL is remaining fees only', () => {
    const pnl = computePositionUnrealizedPnl({
      assetId: '111',
      reason: 'WEATHER_OPEN',
      executableBidVwap: 0.32,
      entryBidVwap: 0.32,
      entryPrice: 0.41,
      quantity: 10,
      entryFeesRemaining: 0.05,
    });
    expect(pnl).toBeCloseTo(-0.05, 4);
  });

  it('weather bid up → green uPnL after fees', () => {
    const pnl = computePositionUnrealizedPnl({
      assetId: '111',
      reason: 'WEATHER_OPEN',
      executableBidVwap: 0.35,
      entryBidVwap: 0.32,
      entryPrice: 0.41,
      quantity: 10,
      entryFeesRemaining: 0.05,
    });
    expect(pnl).toBeCloseTo((0.35 - 0.32) * 10 - 0.05, 4);
    expect(pnl).toBeGreaterThan(0);
  });

  it('weather missing entryBidVwap falls back to bid vs entryPrice', () => {
    const pnl = computePositionUnrealizedPnl({
      assetId: '111',
      reason: 'WEATHER_OPEN',
      executableBidVwap: 0.32,
      entryBidVwap: 0,
      entryPrice: 0.41,
      quantity: 10,
      entryFeesRemaining: 0.05,
    });
    expect(pnl).toBeCloseTo((0.32 - 0.41) * 10 - 0.05, 4);
  });
});

describe('unrealizedPnlEntryBasis', () => {
  it('uses entry bid only for weather when entryBidVwap is present', () => {
    expect(
      unrealizedPnlEntryBasis({
        reason: 'WEATHER_OPEN',
        entryBidVwap: 0.32,
        entryPrice: 0.41,
      }),
    ).toBe(0.32);
    expect(
      unrealizedPnlEntryBasis({
        reason: 'ALGO_OPEN',
        entryBidVwap: 0.32,
        entryPrice: 0.41,
      }),
    ).toBe(0.41);
  });
});

describe('weather close realized PnL', () => {
  it('still uses entry fill (ask) + fees, not entry bid', () => {
    const s = computeSellSettlement({
      isRedemption: false,
      fillPrice: 0.32,
      fillQuantity: 10,
      inputFees: 0.02,
      entryPrice: 0.41,
      entryFeesRemaining: 0.05,
      entryQuantityRemaining: 10,
    });
    expect(s.realizedPnl).toBeCloseTo(0.32 * 10 - 0.41 * 10 - 0.02 - 0.05, 4);
    expect(s.realizedPnl).not.toBeCloseTo(-0.07, 4);
  });
});

describe('computeExecutableCashPnl', () => {
  it('is exit-at-bid vs entry ask minus fees', () => {
    const pnl = computeExecutableCashPnl({
      executableBidVwap: 0.32,
      entryPrice: 0.41,
      quantity: 10,
      entryFeesRemaining: 0.05,
    });
    expect(pnl).toBeCloseTo((0.32 - 0.41) * 10 - 0.05, 4);
  });

  it('returns null without a usable bid', () => {
    expect(
      computeExecutableCashPnl({
        executableBidVwap: 0,
        entryPrice: 0.41,
        quantity: 10,
        entryFeesRemaining: 0,
      }),
    ).toBeNull();
  });
});
