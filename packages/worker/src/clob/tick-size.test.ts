import { describe, expect, it } from 'vitest';
import { ceilToTick, floorToTick, roundToTick } from './tick-size.js';

describe('tick rounding', () => {
  it('roundToTick quantizes to nearest without float residue', () => {
    expect(roundToTick(0.554, '0.01')).toBe(0.55);
    expect(roundToTick(0.555, '0.01')).toBe(0.56);
    expect(roundToTick(0.04, '0.01')).toBe(0.04);
  });

  it('ceilToTick rounds BUY limits up and keeps values already on a tick', () => {
    expect(ceilToTick(0.041, '0.01')).toBe(0.05);
    expect(ceilToTick(0.04, '0.01')).toBe(0.04);
    expect(ceilToTick(0.04 + Number.EPSILON, '0.01')).toBe(0.04);
  });

  it('floorToTick rounds SELL limits down and keeps values already on a tick', () => {
    expect(floorToTick(0.049, '0.01')).toBe(0.04);
    expect(floorToTick(0.05, '0.01')).toBe(0.05);
    expect(floorToTick(0.05 - Number.EPSILON, '0.01')).toBe(0.05);
  });
});
