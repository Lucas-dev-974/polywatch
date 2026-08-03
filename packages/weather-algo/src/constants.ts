/**
 * Named constants for weather-algo magic numbers.
 *
 * Values that already have a default in the `WeatherConfig` entity are not
 * extracted here — they remain explicit fallbacks at their use site. Only
 * hardcoded literals with no config backing are centralized below.
 */

/** Default minimum edge for the forecast strategy (used when no risk config is pushed). */
export const DEFAULT_MIN_EDGE = 0.10;

/** Default max signals per event in multi selection mode. */
export const DEFAULT_MAX_SIGNALS_PER_EVENT = 3;

/** TTL (seconds) for the runtime status Redis key. */
export const RUNTIME_STATUS_TTL_SECONDS = 300;

/** TTL (seconds) for the weather close-queue dedupe key. */
export const CLOSE_QUEUE_DEDUPE_TTL_SECONDS = 120;

/** Default re-entry throttle (ms) after a bucket exit or forecast change. */
export const DEFAULT_REENTRY_THROTTLE_MS = 1_800_000;

/** Fallback hours-to-resolution used when a market has no endDate. */
export const DEFAULT_HOURS_TO_RESOLUTION_FALLBACK = 24;