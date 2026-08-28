import { describe, expect, it } from 'vitest';
import {
  computeSlippagePercent,
  effectiveMaxSlippagePercent,
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

  it('effectiveMaxSlippagePercent floors at minTicks on cheap tokens', () => {
    // 2 ticks at 0.04 = 50 %, so a 7 % config cap is raised.
    expect(effectiveMaxSlippagePercent(7, 0.04, 0.01, 2)).toBeCloseTo(50, 5);
    // At 0.50, 2 ticks = 4 % — the 7 % config cap stays.
    expect(effectiveMaxSlippagePercent(7, 0.5, 0.01, 2)).toBe(7);
    expect(effectiveMaxSlippagePercent(7, 0.04)).toBe(7);
  });

  it('allows a 1-tick WEATHER_OPEN move on a cheap YES that would breach 7 %', () => {
    const result = evaluateSlippageGuard(
      { reason: 'WEATHER_OPEN', referenceVwap: 0.04, side: 'BUY' },
      0.05,
      7,
      { tickSize: 0.01, minTicks: 2 },
    );
    expect(result.blocked).toBe(false);
    expect(result.slippagePercent).toBeCloseTo(25, 5);
  });

  it('still blocks a large adverse move that exceeds both the % cap and the tick floor', () => {
    const result = evaluateSlippageGuard(
      { reason: 'WEATHER_OPEN', referenceVwap: 0.22, side: 'BUY' },
      0.42,
      7,
      { tickSize: 0.01, minTicks: 2 },
    );
    expect(result.blocked).toBe(true);
    expect(result.slippagePercent).toBeCloseTo(90.909, 2);
  });
});
