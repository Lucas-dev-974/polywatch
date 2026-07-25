import { describe, expect, it } from 'vitest';
import {
  computeSlippagePercent,
  evaluateSlippageGuard,
  isForcedExitSlippageExceeded,
} from './slippage-guard.js';

describe('slippage-guard', () => {
  it('blocks guarded entry reasons when slippage exceeds max', () => {
    const result = evaluateSlippageGuard(
      { reason: 'COPY_OPEN', referenceVwap: 0.5 },
      0.6,
      5,
    );
    expect(result.blocked).toBe(true);
    expect(result.slippagePercent).toBeCloseTo(20, 5);
  });

  it('blocks ALGO_OPEN when slippage exceeds max', () => {
    const result = evaluateSlippageGuard(
      { reason: 'ALGO_OPEN', referenceVwap: 0.12 },
      0.57,
      5,
    );
    expect(result.blocked).toBe(true);
    expect(result.slippagePercent).toBeGreaterThan(5);
  });

  it('does not block forced exits but reports excess slippage', () => {
    const result = evaluateSlippageGuard(
      { reason: 'SL', referenceVwap: 0.5 },
      0.6,
      5,
    );
    expect(result.blocked).toBe(false);
    expect(isForcedExitSlippageExceeded(result.slippagePercent, 5)).toBe(true);
  });

  it('computes slippage symmetrically for buy and sell fills', () => {
    expect(computeSlippagePercent(0.55, 0.5)).toBeCloseTo(10, 5);
    expect(computeSlippagePercent(0.45, 0.5)).toBeCloseTo(10, 5);
  });
});
