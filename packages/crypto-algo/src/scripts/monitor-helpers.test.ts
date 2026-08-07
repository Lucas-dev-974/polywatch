import { describe, it, expect } from 'vitest';
import {
  sanitizePositiveNumber,
  toFixed,
  groupBy,
  avg,
  type SignalRow,
} from './monitor-helpers.js';

describe('sanitizePositiveNumber', () => {
  it('returns fallback when raw is undefined', () => {
    expect(sanitizePositiveNumber(undefined, 60, { min: 10 })).toBe(60);
  });

  it('returns fallback when value is below min', () => {
    expect(sanitizePositiveNumber('5', 60, { min: 10 })).toBe(60);
  });

  it('returns parsed value when valid', () => {
    expect(sanitizePositiveNumber('30', 60, { min: 10 })).toBe(30);
  });

  it('caps at max when provided', () => {
    expect(sanitizePositiveNumber('100', 60, { min: 10, max: 48 })).toBe(48);
  });

  it('returns fallback for non-numeric strings', () => {
    expect(sanitizePositiveNumber('abc', 60, { min: 10 })).toBe(60);
  });

  it('returns fallback for NaN', () => {
    expect(sanitizePositiveNumber('NaN', 24, { min: 1 })).toBe(24);
  });

  it('returns fallback for Infinity', () => {
    expect(sanitizePositiveNumber('Infinity', 24, { min: 1 })).toBe(24);
  });

  it('returns fallback for negative numbers', () => {
    expect(sanitizePositiveNumber('-5', 24, { min: 1 })).toBe(24);
  });
});

describe('toFixed', () => {
  it('returns null for null input', () => {
    expect(toFixed(null)).toBeNull();
  });

  it('returns null for undefined input', () => {
    expect(toFixed(undefined)).toBeNull();
  });

  it('returns null for NaN', () => {
    expect(toFixed(NaN)).toBeNull();
  });

  it('rounds to specified digits', () => {
    expect(toFixed(3.14159, 2)).toBe(3.14);
  });

  it('defaults to 4 digits', () => {
    expect(toFixed(3.14159265)).toBe(3.1416);
  });

  it('returns a number, not a string', () => {
    expect(typeof toFixed(1.5, 2)).toBe('number');
  });

  it('handles zero', () => {
    expect(toFixed(0, 4)).toBe(0);
  });
});

describe('groupBy', () => {
  const rows: SignalRow[] = [
    {
      conditionId: '0x1',
      interval: '5m',
      lastSignalOutcome: 'YES',
      lastSignalConfidence: 0.8,
      lastSignalStrategyId: 'naive',
      lastAbstainReason: null,
      upPrice: 0.6,
      downPrice: 0.4,
      upSpreadPct: 0.01,
      downSpreadPct: 0.02,
      wsHealthy: true,
      openPositionsCount: 0,
      openExposureUsd: null,
      unrealizedPnl: null,
      recordedAt: new Date(),
    },
    {
      conditionId: '0x2',
      interval: '5m',
      lastSignalOutcome: 'NO',
      lastSignalConfidence: 0.7,
      lastSignalStrategyId: 'naive',
      lastAbstainReason: 'spread_too_wide',
      upPrice: 0.55,
      downPrice: 0.45,
      upSpreadPct: 0.03,
      downSpreadPct: 0.04,
      wsHealthy: false,
      openPositionsCount: 1,
      openExposureUsd: 10,
      unrealizedPnl: -0.5,
      recordedAt: new Date(),
    },
  ];

  it('groups by interval', () => {
    const result = groupBy(rows, 'interval');
    expect(result).toEqual({ '5m': 2 });
  });

  it('groups by lastSignalOutcome', () => {
    const result = groupBy(rows, 'lastSignalOutcome');
    expect(result).toEqual({ YES: 1, NO: 1 });
  });

  it('groups null values as "unknown"', () => {
    const result = groupBy(rows, 'lastAbstainReason');
    expect(result).toEqual({ unknown: 1, spread_too_wide: 1 });
  });

  it('returns empty object for empty array', () => {
    expect(groupBy([], 'interval')).toEqual({});
  });
});

describe('avg', () => {
  it('returns null for empty array', () => {
    expect(avg([])).toBeNull();
  });

  it('computes average of single element', () => {
    expect(avg([5])).toBe(5);
  });

  it('computes average of multiple elements', () => {
    expect(avg([1, 2, 3, 4])).toBe(2.5);
  });

  it('rounds to 4 decimal places', () => {
    const result = avg([1, 1, 1, 3]);
    expect(result).toBe(1.5);
  });

  it('handles negative numbers', () => {
    expect(avg([-1, -2, -3])).toBe(-2);
  });

  it('returns a number, not a string', () => {
    expect(typeof avg([1, 2])).toBe('number');
  });
});