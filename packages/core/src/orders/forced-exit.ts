/** Reasons that attempt a CLOB exit and may retry on transient failures. */
export const FORCED_EXIT_CLOSE_REASONS = [
  'SL',
  'TP',
  'TRAILING',
  'PRE_CLOSE_LOSS',
  'PRE_CLOSE_WIN',
  'KILL_SWITCH',
] as const;

export type ForcedExitCloseReason = (typeof FORCED_EXIT_CLOSE_REASONS)[number];

export const FORCED_EXIT_RETRYABLE_ERRORS = [
  'no_liquidity',
  'order_not_matched',
  'tick_size_fetch_failed',
] as const;

export function isForcedExitCloseReason(
  reason: string | null | undefined,
): reason is ForcedExitCloseReason {
  return (
    reason != null &&
    (FORCED_EXIT_CLOSE_REASONS as readonly string[]).includes(reason)
  );
}

export function isForcedExitRetryableError(
  error: string | null | undefined,
): boolean {
  return (
    error != null &&
    (FORCED_EXIT_RETRYABLE_ERRORS as readonly string[]).includes(error)
  );
}
