/** WebSocket heartbeat interval (Polymarket requires PING every ~10s). */
export const WS_HEARTBEAT_INTERVAL_MS = 10_000;

/** Max WebSocket reconnect attempts before giving up. */
export const WS_MAX_RECONNECT_ATTEMPTS = 5;

/** Base delay (ms) for WebSocket exponential reconnect back-off. */
export const WS_BASE_RECONNECT_DELAY_MS = 1_000;