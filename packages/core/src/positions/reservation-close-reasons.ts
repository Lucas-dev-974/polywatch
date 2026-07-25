/** Pending entry cancelled because the reservation TTL elapsed before execution. */
export const RESERVATION_CLOSE_REASON_EXPIRED = 'reservation_expired';

/** Pending entry cancelled when the reservation is explicitly released (pipeline error). */
export const RESERVATION_CLOSE_REASON_RELEASED = 'reservation_released';

/** Position still pending — order signal not yet consumed by the worker. */
export const SURVEILLANCE_SKIP_PENDING_EXECUTION = 'pending_execution';
