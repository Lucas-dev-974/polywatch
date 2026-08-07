import type { OrderSignal } from '@polywatch/core';
import { SLIPPAGE_GUARDED_REASONS } from '../constants.js';

export interface SlippageGuardResult {
  blocked: boolean;
  /** Adverse slippage in percent (positive = worse than reference). Favorable is ≤ 0. */
  slippagePercent: number;
}

/**
 * Adverse slippage percent relative to reference VWAP.
 * - BUY: positive when fill is more expensive than reference
 * - SELL: positive when fill is cheaper than reference
 * Without `side`, falls back to absolute distance (legacy / metrics-only).
 */
export function computeSlippagePercent(
  fillPrice: number,
  referenceVwap: number,
  side?: 'BUY' | 'SELL',
): number {
  if (!(referenceVwap > 0)) return 0;
  if (side === 'BUY') {
    return ((fillPrice - referenceVwap) / referenceVwap) * 100;
  }
  if (side === 'SELL') {
    return ((referenceVwap - fillPrice) / referenceVwap) * 100;
  }
  return (Math.abs(fillPrice - referenceVwap) / referenceVwap) * 100;
}

export function evaluateSlippageGuard(
  signal: Pick<OrderSignal, 'reason' | 'referenceVwap' | 'side'>,
  fillPrice: number,
  maxSlippagePercent: number,
): SlippageGuardResult {
  if (signal.referenceVwap == null || signal.referenceVwap <= 0) {
    return { blocked: false, slippagePercent: 0 };
  }

  const slippagePercent = computeSlippagePercent(
    fillPrice,
    signal.referenceVwap,
    signal.side,
  );
  const guarded = (SLIPPAGE_GUARDED_REASONS as readonly string[]).includes(
    signal.reason,
  );

  // Only block adverse slippage (favorable fills have slippagePercent ≤ 0).
  if (guarded && slippagePercent > maxSlippagePercent) {
    return { blocked: true, slippagePercent };
  }

  return { blocked: false, slippagePercent };
}

export function isForcedExitSlippageExceeded(
  slippagePercent: number,
  maxSlippagePercent: number,
): boolean {
  return slippagePercent > maxSlippagePercent;
}
