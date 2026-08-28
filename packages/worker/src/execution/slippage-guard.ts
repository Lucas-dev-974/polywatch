import type { OrderSignal } from '@polywatch/core';
import { MIN_SLIPPAGE_TICKS, SLIPPAGE_GUARDED_REASONS } from '../constants.js';

export interface SlippageGuardResult {
  blocked: boolean;
  /** Adverse slippage in percent (positive = worse than reference). Favorable is ≤ 0. */
  slippagePercent: number;
}

export interface SlippageGuardOptions {
  /** CLOB tick size (e.g. 0.01). When set, the cap cannot be tighter than {@link MIN_SLIPPAGE_TICKS}. */
  tickSize?: number;
  /** Override {@link MIN_SLIPPAGE_TICKS}. */
  minTicks?: number;
}

/**
 * Floor on `maxSlippagePercent` so a 1–2 tick move on a cheap token is not
 * treated as a 20–100 % breach. Without `tickSize`, returns `maxSlippagePercent`.
 */
export function effectiveMaxSlippagePercent(
  maxSlippagePercent: number,
  referenceVwap: number,
  tickSize?: number,
  minTicks: number = MIN_SLIPPAGE_TICKS,
): number {
  if (tickSize == null || !(tickSize > 0) || !(referenceVwap > 0) || minTicks <= 0) {
    return maxSlippagePercent;
  }
  const tickFloorPct = ((minTicks * tickSize) / referenceVwap) * 100;
  return Math.max(maxSlippagePercent, tickFloorPct);
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
  options?: SlippageGuardOptions,
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

  const effectiveMax = effectiveMaxSlippagePercent(
    maxSlippagePercent,
    signal.referenceVwap,
    options?.tickSize,
    options?.minTicks,
  );

  // Only block adverse slippage (favorable fills have slippagePercent ≤ 0).
  if (guarded && slippagePercent > effectiveMax) {
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
