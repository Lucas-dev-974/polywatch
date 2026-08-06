import type { MidHistorySample } from './mid-history-buffer.js';

/** Minimum samples required before the curve gate can block. */
export const CURVE_MIN_POINTS = 3;

/** Minimum span as a fraction of lookback before blocking (anti false-positive). */
export const CURVE_MIN_SPAN_RATIO = 0.5;

export type CurveDescendingGateResult = 'pass' | 'insufficient' | 'descending';

export interface CurveDescendingGateParams {
  minDelta: number;
  lookbackMs: number;
  minPoints?: number;
  minSpanRatio?: number;
}

/**
 * Evaluate whether the mid series shows a descending curve over the lookback window.
 * Returns `insufficient` when history is too sparse (caller should fail-closed).
 */
export function evaluateCurveDescendingGate(
  series: MidHistorySample[],
  params: CurveDescendingGateParams,
): CurveDescendingGateResult {
  const minPoints = params.minPoints ?? CURVE_MIN_POINTS;
  const minSpanRatio = params.minSpanRatio ?? CURVE_MIN_SPAN_RATIO;

  if (series.length < minPoints) {
    return 'insufficient';
  }

  const first = series[0]!;
  const last = series[series.length - 1]!;
  const spanMs = last.t - first.t;
  if (spanMs < params.lookbackMs * minSpanRatio) {
    return 'insufficient';
  }

  const delta = last.mid - first.mid;
  if (delta < -params.minDelta) {
    return 'descending';
  }

  return 'pass';
}
