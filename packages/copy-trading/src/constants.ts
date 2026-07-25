/** Data API positions page limit per request. */
export const DATA_API_PAGE_LIMIT = 500;

/** Maximum number of paginated pages (protects against runaway loops). */
export const DATA_API_MAX_PAGES = 20;

/** Tick size / min-order cache TTL (Polymarket CLOB metadata is stable). */
export const MIN_ORDER_CACHE_TTL_MS = 300_000;

export const HEARTBEAT_INTERVAL_MS = 30_000;
export const BACKEND_READY_TIMEOUT_MS = 60_000;
