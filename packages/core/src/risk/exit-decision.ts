import type { TotalCloseReason } from '../orders/close-signal.js';
import type { OrderReason } from '../types/index.js';
import {
  evaluateSlTpTrailing,
  isPreCloseExitScope,
} from './policy.js';

export type SlTpTrailingInput = Parameters<typeof evaluateSlTpTrailing>[0];

export interface PreCloseExitInput {
  preCloseEnabled: boolean;
  preCloseSeconds: number;
  keepEnabled: boolean;
  keepBidThreshold: number;
  markBid: number;
  timeToEndMs: number;
  marketSettled: boolean;
  acceptingOrders?: boolean | null;
  effectiveTrigger: number;
  effectiveClosure: number;
}

/**
 * Whether a position is in loss territory based on trigger or closure PnL.
 */
export function isLosingPosition(
  effectiveTrigger: number,
  effectiveClosure: number,
): boolean {
  return effectiveTrigger < 0 || effectiveClosure < 0;
}

/**
 * Pre-close exit: within the monitoring window, attempt to exit losing positions
 * before market resolution. When `keepEnabled` is true and the current bid is
 * at or above `keepBidThreshold`, the position is kept open (return null).
 * Otherwise, sell: PRE_CLOSE_LOSS if losing, PRE_CLOSE_WIN if winning.
 */
export function evaluatePreCloseExit(
  input: PreCloseExitInput,
): Extract<OrderReason, 'PRE_CLOSE_LOSS' | 'PRE_CLOSE_WIN'> | null {
  if (input.marketSettled) return null;
  if (!input.preCloseEnabled) return null;

  if (
    !isPreCloseExitScope({
      preCloseEnabled: input.preCloseEnabled,
      preCloseSeconds: input.preCloseSeconds,
      timeToEndMs: input.timeToEndMs,
      acceptingOrders: input.acceptingOrders ?? null,
    })
  ) {
    return null;
  }

  // Keep position if keep is enabled and bid meets the threshold
  if (input.keepEnabled && input.markBid > 0 && input.markBid >= input.keepBidThreshold) {
    return null;
  }

  // Otherwise sell: losing → PRE_CLOSE_LOSS, winning → PRE_CLOSE_WIN
  if (isLosingPosition(input.effectiveTrigger, input.effectiveClosure)) {
    return 'PRE_CLOSE_LOSS';
  }

  return 'PRE_CLOSE_WIN';
}

/** Unified exit decision: SL/TP/trailing → pre-close. */
export function evaluatePositionExit(params: {
  slTpInput: SlTpTrailingInput;
  preCloseInput: PreCloseExitInput;
  /** Skip SL/TP/trailing when market is past CLOB exit (awaiting redemption). */
  suppressSlTp?: boolean;
}): TotalCloseReason | null {
  if (!params.suppressSlTp) {
    const slTp = evaluateSlTpTrailing(params.slTpInput);
    if (slTp) return slTp;
  }

  return evaluatePreCloseExit(params.preCloseInput);
}
