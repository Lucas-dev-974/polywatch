import { describe, it, expect } from 'vitest';
import { calculateEdge, resolveDynamicMinEdge } from './weather-edge.js';

describe('calculateEdge', () => {
  it('returns positive edge when forecast > market', () => {
    expect(calculateEdge(0.35, 0.25)).toBeCloseTo(0.10, 4);
  });
  it('returns negative edge when forecast < market', () => {
    expect(calculateEdge(0.20, 0.30)).toBeCloseTo(-0.10, 4);
  });
  it('returns 0 when equal', () => {
    expect(calculateEdge(0.30, 0.30)).toBe(0);
  });
});

describe('resolveDynamicMinEdge', () => {
  it('returns base edge at J-0 with low uncertainty', () => {
    const edge = resolveDynamicMinEdge(0.5, 3); // 0.5°C std, 3h left
    // 10% base + 2.5% uncertainty penalty - 3% time factor = 9.5%
    expect(edge).toBeCloseTo(0.095, 2);
  });

  it('increases edge with higher uncertainty', () => {
    const edge = resolveDynamicMinEdge(3, 3); // 3°C std, 3h left
    expect(edge).toBeGreaterThan(0.10);
  });

  it('increases edge when far from resolution', () => {
    const edgeNear = resolveDynamicMinEdge(2, 3);
    const edgeFar = resolveDynamicMinEdge(2, 48);
    expect(edgeFar).toBeGreaterThan(edgeNear);
  });

  it('never goes below 5%', () => {
    const edge = resolveDynamicMinEdge(0, 1);
    expect(edge).toBeGreaterThanOrEqual(0.05);
  });
});