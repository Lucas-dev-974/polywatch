import { describe, expect, it } from 'vitest';
import { simulateFakBuyCollateralFill } from '@polywatch/core';

describe('BUY collateral rounding (simulateFill)', () => {
  it('derives 6-decimal market amount then walks pUSD budget', () => {
    const qty = 7.1234567;
    const limit = 0.123456;
    const marketAmount = Number((qty * limit).toFixed(6));
    expect(String(marketAmount)).toMatch(/^\d+(\.\d{1,6})?$/);
    const fill = simulateFakBuyCollateralFill(
      [{ price: limit, size: 1_000_000 }],
      marketAmount,
      limit,
    );
    expect(fill.spentPusd).toBeCloseTo(marketAmount, 6);
    expect(fill.fillQuantity).toBeCloseTo(marketAmount / limit, 6);
  });

  it('matches real collateral path for typical tick prices', () => {
    const qty = 100;
    const limit = 0.47;
    const marketAmount = Number((qty * limit).toFixed(6));
    expect(marketAmount).toBe(47);
    const fill = simulateFakBuyCollateralFill(
      [{ price: 0.47, size: 200 }],
      marketAmount,
      0.5,
    );
    expect(fill.fillQuantity).toBeCloseTo(100, 6);
    expect(fill.spentPusd).toBeCloseTo(47, 6);
  });

  it('overfills when fill price is below padded limit', () => {
    const qty = 100;
    const paddedLimit = 0.5;
    const marketAmount = Number((qty * paddedLimit).toFixed(6));
    const fill = simulateFakBuyCollateralFill(
      [{ price: 0.47, size: 200 }],
      marketAmount,
      paddedLimit,
    );
    expect(marketAmount).toBe(50);
    expect(fill.fillQuantity).toBeCloseTo(50 / 0.47, 6);
    expect(fill.fillQuantity).toBeGreaterThan(qty);
  });
});
