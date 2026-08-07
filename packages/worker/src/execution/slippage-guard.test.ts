import { describe, expect, it } from 'vitest';
import {
  computeSlippagePercent,
  evaluateSlippageGuard,
  isForcedExitSlippageExceeded,
} from './slippage-guard.js';

describe('slippage-guard', () => {
  it('blocks guarded BUY entry when adverse slippage exceeds max', () => {
    const result = evaluateSlippageGuard(
      { reason: 'COPY_OPEN', referenceVwap: 0.5, side: 'BUY' },
      0.6,
      5,
    );
    expect(result.blocked).toBe(true);
    expect(result.slippagePercent).toBeCloseTo(20, 5);
  });

  it('does not block guarded BUY when fill is better than reference', () => {
    const result = evaluateSlippageGuard(
      { reason: 'COPY_OPEN', referenceVwap: 0.5, side: 'BUY' },
      0.4,
      5,
    );
    expect(result.blocked).toBe(false);
    expect(result.slippagePercent).toBeCloseTo(-20, 5);
  });

  it('blocks ALGO_OPEN when adverse slippage exceeds max', () => {
    const result = evaluateSlippageGuard(
      { reason: 'ALGO_OPEN', referenceVwap: 0.12, side: 'BUY' },
      0.57,
      5,
    );
    expect(result.blocked).toBe(true);
    expect(result.slippagePercent).toBeGreaterThan(5);
  });

  it('does not block forced exits but reports excess adverse slippage', () => {
    const result = evaluateSlippageGuard(
      { reason: 'SL', referenceVwap: 0.5, side: 'SELL' },
      0.4,
      5,
    );
    expect(result.blocked).toBe(false);
    expect(isForcedExitSlippageExceeded(result.slippagePercent, 5)).toBe(true);
  });

  it('does not block TP SELL when fill is better (higher) than reference', () => {
    const result = evaluateSlippageGuard(
      { reason: 'TP', referenceVwap: 0.5, side: 'SELL' },
      0.6,
      5,
    );
    expect(result.blocked).toBe(false);
    expect(result.slippagePercent).toBeLessThanOrEqual(0);
  });

  it('computes adverse slippage by side', () => {
    expect(computeSlippagePercent(0.55, 0.5, 'BUY')).toBeCloseTo(10, 5);
    expect(computeSlippagePercent(0.45, 0.5, 'BUY')).toBeCloseTo(-10, 5);
    expect(computeSlippagePercent(0.45, 0.5, 'SELL')).toBeCloseTo(10, 5);
    expect(computeSlippagePercent(0.55, 0.5, 'SELL')).toBeCloseTo(-10, 5);
  });
});
