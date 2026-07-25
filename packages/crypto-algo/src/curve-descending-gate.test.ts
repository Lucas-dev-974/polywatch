import { describe, expect, it } from 'vitest';
import {
  CURVE_MIN_POINTS,
  evaluateCurveDescendingGate,
} from './curve-descending-gate.js';

describe('evaluateCurveDescendingGate', () => {
  const lookbackMs = 10_000;
  const minDelta = 0.01;

  function series(
    startMid: number,
    endMid: number,
    spanMs: number,
    points: number,
    nowMs = 20_000,
  ) {
    const out = [];
    for (let i = 0; i < points; i++) {
      const t =
        points === 1
          ? nowMs
          : nowMs - spanMs + (spanMs * i) / (points - 1);
      const mid =
        points === 1
          ? endMid
          : startMid + ((endMid - startMid) * i) / (points - 1);
      out.push({ t, mid });
    }
    return out;
  }

  it('returns descending when delta below -minDelta', () => {
    const result = evaluateCurveDescendingGate(
      series(0.67, 0.65, 10_000, 5),
      { minDelta, lookbackMs },
    );
    expect(result).toBe('descending');
  });

  it('returns pass on flat curve within deadband', () => {
    const result = evaluateCurveDescendingGate(
      series(0.65, 0.655, 10_000, 5),
      { minDelta, lookbackMs },
    );
    expect(result).toBe('pass');
  });

  it('returns pass on ascending curve', () => {
    const result = evaluateCurveDescendingGate(
      series(0.62, 0.68, 10_000, 5),
      { minDelta, lookbackMs },
    );
    expect(result).toBe('pass');
  });

  it('returns insufficient when fewer than min points', () => {
    const result = evaluateCurveDescendingGate(
      series(0.67, 0.65, 10_000, CURVE_MIN_POINTS - 1),
      { minDelta, lookbackMs },
    );
    expect(result).toBe('insufficient');
  });

  it('returns insufficient when span below 50% lookback', () => {
    const result = evaluateCurveDescendingGate(
      series(0.67, 0.65, 4_000, 5),
      { minDelta, lookbackMs },
    );
    expect(result).toBe('insufficient');
  });

  it('returns pass when delta is within deadband above -minDelta', () => {
    const result = evaluateCurveDescendingGate(
      [
        { t: 10_000, mid: 0.7 },
        { t: 15_000, mid: 0.695 },
        { t: 20_000, mid: 0.691 },
      ],
      { minDelta, lookbackMs },
    );
    expect(result).toBe('pass');
  });
});
