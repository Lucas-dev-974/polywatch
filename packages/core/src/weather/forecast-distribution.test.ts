import { describe, it, expect } from 'vitest';
import {
  buildTempProbabilityDistribution,
  normalCDF,
  computeCdfBelow,
  computeCdfAbove,
} from './forecast-distribution.js';

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

describe('computeCdfBelow / computeCdfAbove (convention de bin)', () => {
  it('computeCdfBelow applies the +0.5 bin offset', () => {
    // mean=0, std=1 : computeCdfBelow(0) = CDF(0.5) ≈ 0.6915
    expect(computeCdfBelow(0, 0, 1)).toBeCloseTo(normalCDF(0.5, 0, 1), 4);
    expect(computeCdfBelow(0, 0, 1)).toBeCloseTo(0.6915, 3);
    // computeCdfBelow(-1) = CDF(-0.5) ≈ 0.3085
    expect(computeCdfBelow(-1, 0, 1)).toBeCloseTo(normalCDF(-0.5, 0, 1), 4);
    expect(computeCdfBelow(-1, 0, 1)).toBeCloseTo(0.3085, 3);
  });

  it('computeCdfAbove applies the -0.5 bin offset', () => {
    // mean=0, std=1 : computeCdfAbove(0) = 1 - CDF(-0.5) ≈ 0.6915
    expect(computeCdfAbove(0, 0, 1)).toBeCloseTo(1 - normalCDF(-0.5, 0, 1), 4);
    expect(computeCdfAbove(0, 0, 1)).toBeCloseTo(0.6915, 3);
    expect(computeCdfAbove(1, 0, 1)).toBeCloseTo(1 - normalCDF(0.5, 0, 1), 4);
  });

  it('bin coherence: below(X) + above(X) - P(bin X) ≈ 1', () => {
    // Le bin X est compté dans les deux (moitié haute de below, moitié basse
    // de above) ; on le soustrait une fois pour retrouver l'exhaustivité.
    const X = 0;
    const pBin = normalCDF(X + 0.5, 0, 1) - normalCDF(X - 0.5, 0, 1);
    const sum = computeCdfBelow(X, 0, 1) + computeCdfAbove(X, 0, 1) - pBin;
    expect(sum).toBeCloseTo(1, 4);
  });

  it('disjoint exhaustiveness: below(X) + above(X+1) ≈ 1', () => {
    // Les deux moitiés disjointes de part et d'autre de X+0.5 couvrent tout.
    const X = 0;
    const sum = computeCdfBelow(X, 0, 1) + computeCdfAbove(X + 1, 0, 1);
    expect(sum).toBeCloseTo(1, 4);
  });
});