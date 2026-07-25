import type { OrderSignal } from '@polywatch/core';
import { SLIPPAGE_GUARDED_REASONS } from '../constants.js';

export interface SlippageGuardResult {
  blocked: boolean;
  slippagePercent: number;
}

export function computeSlippagePercent(
  fillPrice: number,
  referenceVwap: number,
): number {
  return (Math.abs(fillPrice - referenceVwap) / referenceVwap) * 100;
}

export function evaluateSlippageGuard(
  signal: Pick<OrderSignal, 'reason' | 'referenceVwap'>,
  fillPrice: number,
  maxSlippagePercent: number,
): SlippageGuardResult {
  if (signal.referenceVwap == null || signal.referenceVwap <= 0) {
    return { blocked: false, slippagePercent: 0 };
  }

  const slippagePercent = computeSlippagePercent(fillPrice, signal.referenceVwap);
  const guarded = (SLIPPAGE_GUARDED_REASONS as readonly string[]).includes(
    signal.reason,
  );

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
