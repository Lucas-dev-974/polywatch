import { describe, expect, it } from 'vitest';
import { computeTakerFee, marketPlatformFeeParams } from './fees.js';

describe('computeTakerFee', () => {
  it('matches Polymarket docs — crypto 100 shares @ 0.50 (r=0.07)', () => {
    expect(
      computeTakerFee(100, 0.5, { feeRate: 0.07, feeExponent: 1 }),
    ).toBe(1.75);
  });

  it('matches Polymarket docs — sports 100 shares @ 0.50 (r=0.03)', () => {
    expect(
      computeTakerFee(100, 0.5, { feeRate: 0.03, feeExponent: 1 }),
    ).toBe(0.75);
  });

  it('matches Polymarket docs — politics 100 shares @ 0.50 (r=0.04)', () => {
    expect(
      computeTakerFee(100, 0.5, { feeRate: 0.04, feeExponent: 1 }),
    ).toBe(1);
  });

  it('applies fee exponent from CLOB fd.e', () => {
    expect(
      computeTakerFee(100, 0.5, { feeRate: 0.05, feeExponent: 2 }),
    ).toBeCloseTo(0.3125, 4);
  });

  it('returns zero when fee rate is zero', () => {
    expect(computeTakerFee(10, 0.5, { feeRate: 0, feeExponent: 1 })).toBe(0);
  });

  it('returns zero for dust fees below minimum', () => {
    expect(
      computeTakerFee(0.001, 0.99, { feeRate: 0.07, feeExponent: 1 }),
    ).toBe(0);
  });
});

describe('marketPlatformFeeParams', () => {
  it('returns zero params when market has no fee rate', () => {
    expect(marketPlatformFeeParams({ feeRate: 0, feeExponent: 1 })).toEqual({
      feeRate: 0,
      feeExponent: 1,
    });
  });

  it('defaults invalid exponent to 1', () => {
    expect(
      marketPlatformFeeParams({ feeRate: 0.07, feeExponent: 0 }),
    ).toEqual({ feeRate: 0.07, feeExponent: 1 });
  });
});
