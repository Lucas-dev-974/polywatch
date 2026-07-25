import type { OrderSignal } from '@polywatch/core';
import {
  FORCED_EXIT_CLOSE_REASONS,
  FORCED_EXIT_RETRYABLE_ERRORS,
  isForcedExitCloseReason,
  isForcedExitRetryableError,
  isTotalCloseSignal,
} from '@polywatch/core';

export const SL_CLOSE_RETRYABLE_ERRORS = FORCED_EXIT_RETRYABLE_ERRORS;

/** Reasons that are forced exits: we must keep trying to get out of the position. */
export const FORCED_EXIT_REASONS = FORCED_EXIT_CLOSE_REASONS.filter(
  (reason) => reason !== 'TP',
) as readonly Exclude<(typeof FORCED_EXIT_CLOSE_REASONS)[number], 'TP'>[];

export { isForcedExitRetryableError as isSlCloseRetryableError };

/** Any total SELL forced exit (SL/trailing/pre-close loss/kill-switch) may be retried. */
export function isForcedExitSignal(
  signal: Pick<OrderSignal, 'side' | 'reason'>,
): boolean {
  return (
    isTotalCloseSignal(signal) &&
    isForcedExitCloseReason(signal.reason) &&
    signal.reason !== 'TP'
  );
}
