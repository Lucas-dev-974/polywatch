import { describe, expect, it } from 'vitest';
import { parseLimit, parseOffset } from './query-params.js';

describe('parseLimit', () => {
  it('returns fallback for non-numeric values', () => {
    expect(parseLimit('abc', 50, 100)).toBe(50);
    expect(parseLimit(NaN, 50, 100)).toBe(50);
    expect(parseLimit(undefined, 50, 100)).toBe(50);
  });

  it('clamps to [1, max]', () => {
    expect(parseLimit(0, 50, 100)).toBe(1);
    expect(parseLimit(1000, 50, 100)).toBe(100);
    expect(parseLimit(25, 50, 100)).toBe(25);
  });
});

describe('parseOffset', () => {
  it('never returns negative', () => {
    expect(parseOffset(-5)).toBe(0);
    expect(parseOffset(10)).toBe(10);
  });
});
