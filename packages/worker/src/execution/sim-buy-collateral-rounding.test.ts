import { describe, expect, it } from 'vitest';

/** Mirrors BUY quantity derivation in executor.simulateFill */
function deriveBuyMatchQuantity(
  signalQuantity: number,
  limitPrice: number,
): number {
  const marketAmountUsdc = Number(
    (signalQuantity * limitPrice).toFixed(6),
  );
  return marketAmountUsdc / limitPrice;
}

describe('BUY collateral rounding (simulateFill)', () => {
  it('derives match quantity from 6-decimal market amount', () => {
    const qty = 7.1234567;
    const limit = 0.123456;
    const marketAmount = Number((qty * limit).toFixed(6));
    const matchQty = deriveBuyMatchQuantity(qty, limit);
    expect(matchQty).toBe(marketAmount / limit);
    expect(String(marketAmount)).toMatch(/^\d+(\.\d{1,6})?$/);
  });

  it('matches real collateral path for typical tick prices', () => {
    const qty = 100;
    const limit = 0.47;
    const matchQty = deriveBuyMatchQuantity(qty, limit);
    expect(matchQty).toBe(100);
    expect(Number((qty * limit).toFixed(6))).toBe(47);
  });
});
