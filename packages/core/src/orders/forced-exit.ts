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
  'clob_rejected',
  'tick_size_fetch_failed',
  'insufficient_allowance',
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
  if (error == null) return false;
  // Prefix-aware: `clob_rejected:<reason>` must stay retryable even though the
  // reason suffix varies. Exact match also supported for the bare code.
  return (FORCED_EXIT_RETRYABLE_ERRORS as readonly string[]).some(
    (code) => error === code || error.startsWith(`${code}:`),
  );
}
