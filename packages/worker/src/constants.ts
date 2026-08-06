/**
 * Shared numeric constants for the worker package.
 *
 * Constants are exported both as individual named exports (for backward
 * compatibility) and as properties of the `workerConfig` mutable object.
 * At boot time, `initWorkerConfigCache()` loads overrides from the
 * `system_config` database table. If the DB is unreachable or a key is
 * absent, the hardcoded default is used — zero risk of regression.
 *
 * New code should prefer `workerConfig.XXX` over the individual export.
 */

import type { DataSource } from 'typeorm';
import { SystemConfigService } from '@polywatch/core/services/system-config.service';

// ── Mutable config object (populated at boot, read synchronously after) ──

export const workerConfig: Record<string, number> = {};

// ── Individual constants (backward-compatible, read from workerConfig) ──

/** Heartbeat publish interval (worker → Redis). */
export const HEARTBEAT_INTERVAL_MS = 30_000;

/** Interval between WebSocket book subscription reconciliation cycles. */
export const BOOK_SUBSCRIPTION_SYNC_MS = 10_000;

/** WebSocket order-book heartbeat ping interval (Polymarket requires PING every ~10s). */
export const WS_HEARTBEAT_INTERVAL_MS = 10_000;

/**
 * Book freshness threshold for REST re-sync.
 * A book older than this is considered stale and will be refreshed via REST
 * on the next syncAll cycle (usually triggered every 10s when WS is healthy).
 * Helps reduce unnecessary REST calls when the WS is streaming normally.
 */
export const STALE_BOOK_THRESHOLD_MS = 30_000;

/** Max WebSocket reconnect attempts before giving up (market + user channels). */
export const WS_MAX_RECONNECT_ATTEMPTS = 5;

/** Timeout for the initial WebSocket connect() promise (ms). */
/** Prevents the worker from hanging indefinitely if the WS server is unreachable. */
export const WS_CONNECT_TIMEOUT_MS = 15_000;

/** Base delay (ms) for WebSocket exponential reconnect back-off. */
export const WS_BASE_RECONNECT_DELAY_MS = 1_000;

/** Default market-resolution watcher poll interval. */
export const MARKET_RESOLUTION_LOOP_MS = 15_000;

/** Default redemption handler poll interval. */
export const REDEMPTION_LOOP_MS = 15_000;

/** Default closing-watchdog poll interval. */
export const CLOSING_WATCHDOG_LOOP_MS = 15_000;

/** Minimum spacing between forced exit signal emissions per position. */
export const FORCED_EXIT_RETRY_COOLDOWN_MS = 5_000;

/** Minimum elapsed time before SL confirmation can fire (with tick count). */
export const SL_CONFIRMATION_MIN_WINDOW_MS = 500;

/** Default reservation janitor poll interval. */
export const RESERVATION_JANITOR_LOOP_MS = 60_000;

/** Orphan sim `placing` executions whose position already left the expected state. */
export const PLACING_JANITOR_LOOP_MS = 15_000;

/** Pending algo entries with a reservation but no BUY execution row. */
export const PENDING_ENTRY_JANITOR_LOOP_MS = 30_000;

/** Strategy evaluation loop interval. */
export const STRATEGY_EVAL_INTERVAL_MS = 100;

/** Move detector base interval between poll cycles (default; overridden by DB config). */
export { DEFAULT_MOVE_DETECTOR_INTERVAL_MS as MOVE_DETECTOR_INTERVAL_MS } from '@polywatch/core';

/** How long the worker waits for the backend Redis ready signal before falling back. */
export const BACKEND_READY_TIMEOUT_MS = 60_000;

/** Data API positions page limit per request. */
export const DATA_API_PAGE_LIMIT = 500;

/** Maximum number of paginated pages (protects against runaway loops). */
export const DATA_API_MAX_PAGES = 20;

/** PnL tick throttle for strategy evaluation. */
export const PNL_TICK_THROTTLE_MS = 100;


/** Kill switch re-check interval. */
export const KILL_SWITCH_CHECK_INTERVAL_MS = 10_000;

/** Market / CLOB lifecycle refresh throttle per market (Gamma refresh). */
export const MARKET_REFRESH_THROTTLE_MS = 15_000;

/** Real pUSD balance cache TTL (avoid hammering RPC). */
export const REAL_BALANCE_CACHE_TTL = 10_000;

/** Tick size cache TTL (Polymarket CLOB tick sizes are stable). */
export const TICK_SIZE_CACHE_TTL = 300_000;

/** Max wait for CLOB createAndPostMarketOrder before treating as delayed. */
export const CLOB_ORDER_TIMEOUT_MS = 30_000;

/** Max wait for a one-shot CLOB order-book REST fetch. */
export const CLOB_BOOK_FETCH_TIMEOUT_MS = 10_000;

/**
 * Artificial delay before sim FAK match (models CLOB RTT / book race).
 * Env `SIM_EXECUTION_LATENCY_MS` overrides; `0` disables. Invalid values → 150.
 */
function resolveSimExecutionLatencyMs(): number {
  const raw = process.env.SIM_EXECUTION_LATENCY_MS;
  if (raw === undefined || raw === '') return 150;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 150;
}
export const SIM_EXECUTION_LATENCY_MS = resolveSimExecutionLatencyMs();

/** CLOB order response amounts use 6 decimal places (USDC / shares raw units). */
export const CLOB_AMOUNT_DECIMALS = 6;

/** Fee rate cache TTL (Polymarket fee rates are stable per token). */
export const FEE_RATE_CACHE_TTL = 300_000;

/**
 * Order reasons where max slippage is enforced before placement.
 * Forced exits (SL, kill switch, etc.) intentionally skip the guard.
 */
export const SLIPPAGE_GUARDED_REASONS = [
  'COPY_OPEN',
  'COPY_INCREASE',
  'ALGO_OPEN',
  'ALGO_INCREASE',
  'WEATHER_OPEN',
  'TP',
  'PRE_CLOSE_WIN',
] as const;

/**
 * Max age (ms) for the order book bid used in SL/TP evaluation. Aligned with
 * {@link STALE_BOOK_THRESHOLD_MS} (the REST re-sync trigger): a book older
 * than this skips SL/TP evaluation (fail-closed — no close signal emitted).
 * SystemConfig key kept as `worker.book_freshness.warn_max_age_ms` for compatibility.
 */
export const BOOK_FRESHNESS_WARN_MAX_AGE_MS = 30_000;

/**
 * Max age (ms) for `lastTradePrice` used as a conservative mark in illiquid
 * markets. A last trade older than this is considered stale and should not
 * pull the mark price down (or up) on its own. Aligned with
 * {@link LAST_CLOSEABLE_BID_MAX_AGE_MS}. Warn-only at the point of usage.
 */
export const LAST_TRADE_PRICE_MAX_AGE_MS = 60_000;

// ── SystemConfig key mapping ──

const CONFIG_KEY_MAP: Record<string, string> = {
  HEARTBEAT_INTERVAL_MS: 'worker.heartbeat.interval_ms',
  BOOK_SUBSCRIPTION_SYNC_MS: 'worker.book.subscription_sync_ms',
  WS_HEARTBEAT_INTERVAL_MS: 'worker.ws.heartbeat_interval_ms',
  STALE_BOOK_THRESHOLD_MS: 'worker.ws.stale_book_threshold_ms',
  WS_MAX_RECONNECT_ATTEMPTS: 'worker.ws.max_reconnect_attempts',
  WS_CONNECT_TIMEOUT_MS: 'worker.ws.connect_timeout_ms',
  WS_BASE_RECONNECT_DELAY_MS: 'worker.ws.base_reconnect_delay_ms',
  MARKET_RESOLUTION_LOOP_MS: 'worker.market_resolution.loop_ms',
  REDEMPTION_LOOP_MS: 'worker.redemption.loop_ms',
  CLOSING_WATCHDOG_LOOP_MS: 'worker.closing_watchdog.loop_ms',
  FORCED_EXIT_RETRY_COOLDOWN_MS: 'worker.forced_exit.retry_cooldown_ms',
  SL_CONFIRMATION_MIN_WINDOW_MS: 'worker.sl_confirmation.min_window_ms',
  RESERVATION_JANITOR_LOOP_MS: 'worker.reservation_janitor.loop_ms',
  PLACING_JANITOR_LOOP_MS: 'worker.placing_janitor.loop_ms',
  STRATEGY_EVAL_INTERVAL_MS: 'worker.strategy.eval_interval_ms',
  BACKEND_READY_TIMEOUT_MS: 'worker.backend_ready.timeout_ms',
  DATA_API_PAGE_LIMIT: 'worker.data_api.page_limit',
  DATA_API_MAX_PAGES: 'worker.data_api.max_pages',
  PNL_TICK_THROTTLE_MS: 'worker.pnl_tick.throttle_ms',
  KILL_SWITCH_CHECK_INTERVAL_MS: 'worker.kill_switch.check_interval_ms',
  MARKET_REFRESH_THROTTLE_MS: 'worker.market_refresh.throttle_ms',
  REAL_BALANCE_CACHE_TTL: 'worker.real_balance.cache_ttl_ms',
  TICK_SIZE_CACHE_TTL: 'worker.tick_size.cache_ttl_ms',
  CLOB_ORDER_TIMEOUT_MS: 'worker.clob.order_timeout_ms',
  CLOB_BOOK_FETCH_TIMEOUT_MS: 'worker.clob.book_fetch_timeout_ms',
  FEE_RATE_CACHE_TTL: 'worker.fee_rate.cache_ttl_ms',
  BOOK_FRESHNESS_WARN_MAX_AGE_MS: 'worker.book_freshness.warn_max_age_ms',
  LAST_TRADE_PRICE_MAX_AGE_MS: 'worker.last_trade_price.max_age_ms',
  CLOB_AMOUNT_DECIMALS: 'worker.clob.amount_decimals',
};

/**
 * Initialize the `workerConfig` cache from the `system_config` database table.
 * Must be called once at worker boot, **after** the DataSource is initialized
 * but **before** any worker logic runs.
 *
 * For each known constant, if a corresponding row exists in `system_config`,
 * the parsed numeric value overrides the hardcoded default in `workerConfig`.
 * Unknown keys are silently ignored.
 */
export async function initWorkerConfigCache(ds: DataSource): Promise<void> {
  const service = new SystemConfigService(ds);
  const all = await service.getAll();
  const dbMap = new Map(all.map((e) => [e.key, e.value]));

  for (const [constName, configKey] of Object.entries(CONFIG_KEY_MAP)) {
    const dbValue = dbMap.get(configKey);
    if (dbValue !== undefined) {
      const num = Number(dbValue);
      if (Number.isFinite(num)) {
        workerConfig[constName] = num;
      }
    }
  }
}
