import { describe, expect, it } from 'vitest';
import {
  CLOB_FLOOR_TICK,
  isAbsurdEntryQty,
  isFloorTickAsk,
  shouldSkipNoLiquidityAsk,
} from './entry-ask-sanity.js';

describe('isAbsurdEntryQty', () => {
  it('flags $1 at 0.001 = 1000 shares', () => {
    expect(isAbsurdEntryQty(1000, 1)).toBe(true);
    expect(isAbsurdEntryQty(1 / 0.001, 1)).toBe(true);
  });

  it('allows genuine 1c-and-up books', () => {
    expect(isAbsurdEntryQty(100, 1)).toBe(false);
    expect(isAbsurdEntryQty(50, 1)).toBe(false);
    expect(isAbsurdEntryQty(250, 5)).toBe(false);
  });
});

describe('shouldSkipNoLiquidityAsk', () => {
  it('skips empty / zero ask', () => {
    expect(
      shouldSkipNoLiquidityAsk({ askVwap: 0, notionalPusd: 1 }),
    ).toBe(true);
  });

  it('skips illiquid books', () => {
    expect(
      shouldSkipNoLiquidityAsk({
        askVwap: 0.4,
        notionalPusd: 1,
        askLiquidityStatus: 'illiquid',
      }),
    ).toBe(true);
  });

  it('skips floor-tick stub even when the 1-share probe looks ok', () => {
    expect(
      shouldSkipNoLiquidityAsk({
        askVwap: CLOB_FLOOR_TICK,
        notionalPusd: 1,
        impliedQty: 1000,
        askLiquidityStatus: 'ok',
      }),
    ).toBe(true);
  });

  it('skips floor tick with no depth', () => {
    expect(
      shouldSkipNoLiquidityAsk({
        askVwap: 0.001,
        notionalPusd: 1,
        askLiquidityStatus: 'partial',
      }),
    ).toBe(true);
  });

  it('does not skip a real mid-price book', () => {
    expect(
      shouldSkipNoLiquidityAsk({
        askVwap: 0.05,
        notionalPusd: 1,
        impliedQty: 20,
        askLiquidityStatus: 'ok',
      }),
    ).toBe(false);
  });
});

describe('isFloorTickAsk', () => {
  it('matches 0.001', () => {
    expect(isFloorTickAsk(0.001)).toBe(true);
    expect(isFloorTickAsk(0.05)).toBe(false);
    expect(isFloorTickAsk(0)).toBe(false);
  });
});