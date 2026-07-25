import { describe, expect, it } from 'vitest';
import {
  entryFeesForPosition,
  entryQuantityForDisplay,
  investedAmount,
  shouldShowMarketEndCountdown,
} from './position';

describe('entryFeesForPosition', () => {
  it('uses entryFeesRemaining for failed open-like statuses', () => {
    expect(
      entryFeesForPosition({
        status: 'failed',
        entryFees: 10,
        entryFeesRemaining: 3,
      }),
    ).toBe(3);
  });

  it('uses entryFees for closed positions', () => {
    expect(
      entryFeesForPosition({
        status: 'closed',
        entryFees: 10,
        entryFeesRemaining: 3,
      }),
    ).toBe(10);
  });
});

describe('shouldShowMarketEndCountdown', () => {
  const futureEnd = '2099-01-01T00:00:00.000Z';

  it('shows countdown for live markets', () => {
    expect(
      shouldShowMarketEndCountdown({
        marketEndDate: futureEnd,
        marketClosed: false,
        marketResolved: false,
      }),
    ).toBe(true);
  });

  it('hides countdown once the market is closed', () => {
    expect(
      shouldShowMarketEndCountdown({
        marketEndDate: futureEnd,
        marketClosed: true,
        marketResolved: false,
      }),
    ).toBe(false);
  });

  it('hides countdown once the market is resolved', () => {
    expect(
      shouldShowMarketEndCountdown({
        marketEndDate: futureEnd,
        marketClosed: false,
        marketResolved: true,
      }),
    ).toBe(false);
  });
});

describe('investedAmount', () => {
  it('includes remaining entry fees for failed positions', () => {
    expect(
      investedAmount({
        status: 'failed',
        quantity: 5,
        entryPrice: 0.4,
        entryFees: 10,
        entryFeesRemaining: 2,
      }),
    ).toBe(4);
  });

  it('uses entryInvestedAmount for closed positions', () => {
    expect(
      investedAmount({
        status: 'closed',
        quantity: 0,
        entryPrice: 0.46,
        entryFees: 0.04,
        entryInvestedAmount: 1.05,
      }),
    ).toBe(1.05);
  });
});

describe('entryQuantityForDisplay', () => {
  it('uses entryQuantityFilled for closed positions with zero quantity', () => {
    expect(
      entryQuantityForDisplay({
        status: 'closed',
        quantity: 0,
        entryQuantityFilled: 2.18,
      }),
    ).toBe(2.18);
  });
});
