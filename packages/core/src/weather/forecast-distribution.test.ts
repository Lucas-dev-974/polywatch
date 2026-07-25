import { describe, it, expect } from 'vitest';
import { buildTempProbabilityDistribution, normalCDF } from './forecast-distribution.js';

describe('normalCDF', () => {
  it('returns 0.5 at mean', () => {
    expect(normalCDF(0, 0, 1)).toBeCloseTo(0.5, 4);
  });
  it('returns ~0.84 at +1 std', () => {
    expect(normalCDF(1, 0, 1)).toBeCloseTo(0.8413, 3);
  });
  it('returns ~0.16 at -1 std', () => {
    expect(normalCDF(-1, 0, 1)).toBeCloseTo(0.1587, 3);
  });
});

describe('buildTempProbabilityDistribution', () => {
  it('assigns highest probability to the mean temperature', () => {
    const dist = buildTempProbabilityDistribution(31, 2, [28, 29, 30, 31, 32, 33]);
    const sorted = [...dist.entries()].sort((a, b) => b[1] - a[1]);
    expect(sorted[0]![0]).toBe(31); // peak at mean
  });

  it('probabilities sum to approximately 1.0', () => {
    const dist = buildTempProbabilityDistribution(31, 2, [25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38]);
    const sum = [...dist.values()].reduce((a, b) => a + b, 0);
    expect(sum).toBeGreaterThan(0.95);
    expect(sum).toBeLessThan(1.05);
  });

  it('handles std dev of 0 (all probability on the exact temp)', () => {
    const dist = buildTempProbabilityDistribution(31, 0, [28, 29, 30, 31, 32, 33]);
    expect(dist.get(31)).toBeCloseTo(1.0, 2);
    expect(dist.get(28)).toBeCloseTo(0, 2);
  });
});