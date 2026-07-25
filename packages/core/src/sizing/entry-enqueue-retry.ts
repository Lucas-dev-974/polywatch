/** Cooldown between bounded force re-enqueues when the primary dedupe marker is still set. */
export const ENTRY_ENQUEUE_RETRY_COOLDOWN_SECONDS = 45;

/** Max force re-enqueues allowed within one reservation TTL window. */
export const ENTRY_ENQUEUE_MAX_RETRIES_PER_RESERVATION = 2;
