import type { ForcedExitCloseReason } from './forced-exit.js';

/** Why a decided forced-exit signal was not enqueued. */
export const EXIT_EMIT_BLOCK_REASONS = [
  'no_close_bid',
  'below_min_order_size',
  'forced_exit_retries_exhausted',
  'forced_exit_cooldown',
  'sl_pending_confirmation',
  'in_flight_buy',
] as const;

export type ExitEmitBlockReason = (typeof EXIT_EMIT_BLOCK_REASONS)[number];

/** Block reasons that warrant operator alerts when they persist. */
export const CRITICAL_EXIT_EMIT_BLOCK_REASONS: ReadonlySet<ExitEmitBlockReason> =
  new Set([
    'no_close_bid',
    'below_min_order_size',
    'forced_exit_retries_exhausted',
  ]);

/** Close reasons that escalate a critical block to error severity. */
export const CRITICAL_EXIT_EMIT_CLOSE_REASONS: ReadonlySet<string> = new Set([
  'SL',
  'TRAILING',
  'KILL_SWITCH',
]);

export function isExitEmitBlockReason(
  value: string | null | undefined,
): value is ExitEmitBlockReason {
  return (
    value != null &&
    (EXIT_EMIT_BLOCK_REASONS as readonly string[]).includes(value)
  );
}

export function isCriticalExitEmitBlock(
  blockReason: string | null | undefined,
  closeReason: string | null | undefined,
): boolean {
  if (!isExitEmitBlockReason(blockReason)) return false;
  if (!CRITICAL_EXIT_EMIT_BLOCK_REASONS.has(blockReason)) return false;
  if (blockReason === 'below_min_order_size') {
    return (
      closeReason != null && CRITICAL_EXIT_EMIT_CLOSE_REASONS.has(closeReason)
    );
  }
  if (blockReason === 'no_close_bid') {
    return (
      closeReason != null && CRITICAL_EXIT_EMIT_CLOSE_REASONS.has(closeReason)
    );
  }
  return true;
}

export type ExitEmitBlockCloseReason = ForcedExitCloseReason;
