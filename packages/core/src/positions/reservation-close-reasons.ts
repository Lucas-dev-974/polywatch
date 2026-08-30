/** Pending entry cancelled because the reservation TTL elapsed before execution. */
export const RESERVATION_CLOSE_REASON_EXPIRED = 'reservation_expired';

/** Pending entry cancelled when the reservation is explicitly released (pipeline error). */
export const RESERVATION_CLOSE_REASON_RELEASED = 'reservation_released';

/** Position still pending — order signal not yet consumed by the worker. */
export const SURVEILLANCE_SKIP_PENDING_EXECUTION = 'pending_execution';

const FAILED_BUY_CLOSE_REASON_MAX_LEN = 64;

/**
 * Close reason for a pending position cancelled by a failed BUY.
 * Prefer the execution error (`no_liquidity`, `order_not_matched`, …) so
 * Historique / audit do not lump every failed FAK under reservation_released.
 */
export function closeReasonFromFailedBuy(
  error: string | null | undefined,
): string {
  if (!error) return RESERVATION_CLOSE_REASON_RELEASED;
  const code = error.split(':')[0]?.trim() ?? '';
  if (!code || code.length > FAILED_BUY_CLOSE_REASON_MAX_LEN) {
    return RESERVATION_CLOSE_REASON_RELEASED;
  }
  return code;
}

/**
 * True when a cancelled row never opened (qty 0, no fill). These are failed
 * entry attempts, not history positions.
 */
export function isNeverOpenedCancelled(input: {
  status: string;
  openedAt?: Date | string | null;
}): boolean {
  return input.status === 'cancelled' && (input.openedAt == null || input.openedAt === '');
}