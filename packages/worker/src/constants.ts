/**
 * Shared numeric constants for the worker package.
 *
 * Defaults live in `WORKER_CONFIG_DEFAULTS`. At boot, `initWorkerConfigCache()`
 * overlays DB overrides onto `workerConfig`, then syncs the named `export let`
 * bindings so existing call sites pick up overrides without code changes.
 *
 * Prefer reading via the named exports (or `workerConfig.XXX`) after init.
 */

import type { DataSource } from 'typeorm';
import { SystemConfigService } from '@polywatch/core/services/system-config.service';

export const WORKER_CONFIG_DEFAULTS = {
  HEARTBEAT_INTERVAL_MS: 30_000,
  BOOK_SUBSCRIPTION_SYNC_MS: 10_000,
  WS_HEARTBEAT_INTERVAL_MS: 10_000,
  STALE_BOOK_THRESHOLD_MS: 30_000,
  WS_MAX_RECONNECT_ATTEMPTS: 5,
  WS_CONNECT_TIMEOUT_MS: 15_000,
  WS_BASE_RECONNECT_DELAY_MS: 1_000,
  MARKET_RESOLUTION_LOOP_MS: 15_000,
  REDEMPTION_LOOP_MS: 15_000,
  CLOSING_WATCHDOG_LOOP_MS: 15_000,
  FORCED_EXIT_RETRY_COOLDOWN_MS: 5_000,
  SL_CONFIRMATION_MIN_WINDOW_MS: 500,
  RESERVATION_JANITOR_LOOP_MS: 60_000,
  PLACING_JANITOR_LOOP_MS: 15_000,
  PENDING_ENTRY_JANITOR_LOOP_MS: 30_000,
  STRATEGY_EVAL_INTERVAL_MS: 100,
  BACKEND_READY_TIMEOUT_MS: 60_000,
  DATA_API_PAGE_LIMIT: 500,
  DATA_API_MAX_PAGES: 20,
  PNL_TICK_THROTTLE_MS: 100,
  KILL_SWITCH_CHECK_INTERVAL_MS: 10_000,
  MARKET_REFRESH_THROTTLE_MS: 15_000,
  REAL_BALANCE_CACHE_TTL: 10_000,
  TICK_SIZE_CACHE_TTL: 300_000,
  CLOB_ORDER_TIMEOUT_MS: 30_000,
  CLOB_BOOK_FETCH_TIMEOUT_MS: 10_000,
  CLOB_AMOUNT_DECIMALS: 6,
  FEE_RATE_CACHE_TTL: 300_000,
  BOOK_FRESHNESS_WARN_MAX_AGE_MS: 30_000,
  LAST_TRADE_PRICE_MAX_AGE_MS: 60_000,
} as const;

export type WorkerConfigKey = keyof typeof WORKER_CONFIG_DEFAULTS;

/** Mutable config object — seeded with defaults, overlaid from DB at boot. */
export const workerConfig: Record<string, number> = {
  ...WORKER_CONFIG_DEFAULTS,
};

function resolveConfig(key: WorkerConfigKey): number {
  const value = workerConfig[key];
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : WORKER_CONFIG_DEFAULTS[key];
}

// ── Individual exports (live bindings synced after initWorkerConfigCache) ──

/** Heartbeat publish interval (worker → Redis). */
export let HEARTBEAT_INTERVAL_MS: number =
  WORKER_CONFIG_DEFAULTS.HEARTBEAT_INTERVAL_MS;

/** Interval between WebSocket book subscription reconciliation cycles. */
export let BOOK_SUBSCRIPTION_SYNC_MS: number =
  WORKER_CONFIG_DEFAULTS.BOOK_SUBSCRIPTION_SYNC_MS;

/** WebSocket order-book heartbeat ping interval (Polymarket requires PING every ~10s). */
export let WS_HEARTBEAT_INTERVAL_MS: number =
  WORKER_CONFIG_DEFAULTS.WS_HEARTBEAT_INTERVAL_MS;

/**
 * Book freshness threshold for REST re-sync.
 * A book older than this is considered stale and will be refreshed via REST
 * on the next syncAll cycle (usually triggered every 10s when WS is healthy).
 */
export let STALE_BOOK_THRESHOLD_MS: number =
  WORKER_CONFIG_DEFAULTS.STALE_BOOK_THRESHOLD_MS;

/** Max WebSocket reconnect attempts before giving up (market + user channels). */
export let WS_MAX_RECONNECT_ATTEMPTS: number =
  WORKER_CONFIG_DEFAULTS.WS_MAX_RECONNECT_ATTEMPTS;

/** Timeout for the initial WebSocket connect() promise (ms). */
export let WS_CONNECT_TIMEOUT_MS: number =
  WORKER_CONFIG_DEFAULTS.WS_CONNECT_TIMEOUT_MS;

/** Base delay (ms) for WebSocket exponential reconnect back-off. */
export let WS_BASE_RECONNECT_DELAY_MS: number =
  WORKER_CONFIG_DEFAULTS.WS_BASE_RECONNECT_DELAY_MS;

/** Default market-resolution watcher poll interval. */
export let MARKET_RESOLUTION_LOOP_MS: number =
  WORKER_CONFIG_DEFAULTS.MARKET_RESOLUTION_LOOP_MS;

/** Default redemption handler poll interval. */
export let REDEMPTION_LOOP_MS: number = WORKER_CONFIG_DEFAULTS.REDEMPTION_LOOP_MS;

/** Default closing-watchdog poll interval. */
export let CLOSING_WATCHDOG_LOOP_MS: number =
  WORKER_CONFIG_DEFAULTS.CLOSING_WATCHDOG_LOOP_MS;

/** Minimum spacing between forced exit signal emissions per position. */
export let FORCED_EXIT_RETRY_COOLDOWN_MS: number =
  WORKER_CONFIG_DEFAULTS.FORCED_EXIT_RETRY_COOLDOWN_MS;

/** Minimum elapsed time before SL confirmation can fire (with tick count). */
export let SL_CONFIRMATION_MIN_WINDOW_MS: number =
  WORKER_CONFIG_DEFAULTS.SL_CONFIRMATION_MIN_WINDOW_MS;

/** Default reservation janitor poll interval. */
export let RESERVATION_JANITOR_LOOP_MS: number =
  WORKER_CONFIG_DEFAULTS.RESERVATION_JANITOR_LOOP_MS;

/** Orphan sim `placing` executions whose position already left the expected state. */
export let PLACING_JANITOR_LOOP_MS: number =
  WORKER_CONFIG_DEFAULTS.PLACING_JANITOR_LOOP_MS;

/** Pending algo entries with a reservation but no BUY execution row. */
export let PENDING_ENTRY_JANITOR_LOOP_MS: number =
  WORKER_CONFIG_DEFAULTS.PENDING_ENTRY_JANITOR_LOOP_MS;

/** Strategy evaluation loop interval. */
export let STRATEGY_EVAL_INTERVAL_MS: number =
  WORKER_CONFIG_DEFAULTS.STRATEGY_EVAL_INTERVAL_MS;

/** Move detector base interval between poll cycles (default; overridden by DB config). */
export { DEFAULT_MOVE_DETECTOR_INTERVAL_MS as MOVE_DETECTOR_INTERVAL_MS } from '@polywatch/core';

/** How long the worker waits for the backend Redis ready signal before falling back. */
export let BACKEND_READY_TIMEOUT_MS: number =
  WORKER_CONFIG_DEFAULTS.BACKEND_READY_TIMEOUT_MS;

/** Data API positions page limit per request. */
export let DATA_API_PAGE_LIMIT: number =
  WORKER_CONFIG_DEFAULTS.DATA_API_PAGE_LIMIT;

/** Maximum number of paginated pages (protects against runaway loops). */
export let DATA_API_MAX_PAGES: number = WORKER_CONFIG_DEFAULTS.DATA_API_MAX_PAGES;

/** PnL tick throttle for strategy evaluation. */
export let PNL_TICK_THROTTLE_MS: number =
  WORKER_CONFIG_DEFAULTS.PNL_TICK_THROTTLE_MS;

/** Kill switch re-check interval. */
export let KILL_SWITCH_CHECK_INTERVAL_MS: number =
  WORKER_CONFIG_DEFAULTS.KILL_SWITCH_CHECK_INTERVAL_MS;

/** Market / CLOB lifecycle refresh throttle per market (Gamma refresh). */
export let MARKET_REFRESH_THROTTLE_MS: number =
  WORKER_CONFIG_DEFAULTS.MARKET_REFRESH_THROTTLE_MS;

/** Real pUSD balance cache TTL (avoid hammering RPC). */
export let REAL_BALANCE_CACHE_TTL: number =
  WORKER_CONFIG_DEFAULTS.REAL_BALANCE_CACHE_TTL;

/** Tick size cache TTL (Polymarket CLOB tick sizes are stable). */
export let TICK_SIZE_CACHE_TTL: number =
  WORKER_CONFIG_DEFAULTS.TICK_SIZE_CACHE_TTL;

/** Max wait for CLOB createAndPostMarketOrder before treating as delayed. */
export let CLOB_ORDER_TIMEOUT_MS: number =
  WORKER_CONFIG_DEFAULTS.CLOB_ORDER_TIMEOUT_MS;

/** Max wait for a one-shot CLOB order-book REST fetch. */
export let CLOB_BOOK_FETCH_TIMEOUT_MS: number =
  WORKER_CONFIG_DEFAULTS.CLOB_BOOK_FETCH_TIMEOUT_MS;

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
export let CLOB_AMOUNT_DECIMALS: number =
  WORKER_CONFIG_DEFAULTS.CLOB_AMOUNT_DECIMALS;

/** Fee rate cache TTL (Polymarket fee rates are stable per token). */
export let FEE_RATE_CACHE_TTL: number =
  WORKER_CONFIG_DEFAULTS.FEE_RATE_CACHE_TTL;

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
 * Minimum adverse move, in tick increments, always tolerated by the slippage
 * guard. On cheap weather YES tokens (1–5 ¢) one CLOB tick is 20–100 % of
 * `referenceVwap`, so a fixed `maxSlippagePercent` (e.g. 7 %) rejects fills
 * that only moved by a single tick. The effective cap is
 * `max(maxSlippagePercent, minTicks × tick / referenceVwap × 100)`.
 */
export const MIN_SLIPPAGE_TICKS = 2;

/**
 * Max age (ms) for the order book bid used in SL/TP evaluation. Aligned with
 * {@link STALE_BOOK_THRESHOLD_MS} (the REST re-sync trigger): a book older
 * than this skips SL/TP evaluation (fail-closed — no close signal emitted).
 * SystemConfig key kept as `worker.book_freshness.warn_max_age_ms` for compatibility.
 */
export let BOOK_FRESHNESS_WARN_MAX_AGE_MS: number =
  WORKER_CONFIG_DEFAULTS.BOOK_FRESHNESS_WARN_MAX_AGE_MS;

/**
 * Max age (ms) for `lastTradePrice` used as a conservative mark in illiquid
 * markets. A last trade older than this is considered stale and should not
 * pull the mark price down (or up) on its own.
 */
export let LAST_TRADE_PRICE_MAX_AGE_MS: number =
  WORKER_CONFIG_DEFAULTS.LAST_TRADE_PRICE_MAX_AGE_MS;

function syncNamedExportsFromWorkerConfig(): void {
  HEARTBEAT_INTERVAL_MS = resolveConfig('HEARTBEAT_INTERVAL_MS');
  BOOK_SUBSCRIPTION_SYNC_MS = resolveConfig('BOOK_SUBSCRIPTION_SYNC_MS');
  WS_HEARTBEAT_INTERVAL_MS = resolveConfig('WS_HEARTBEAT_INTERVAL_MS');
  STALE_BOOK_THRESHOLD_MS = resolveConfig('STALE_BOOK_THRESHOLD_MS');
  WS_MAX_RECONNECT_ATTEMPTS = resolveConfig('WS_MAX_RECONNECT_ATTEMPTS');
  WS_CONNECT_TIMEOUT_MS = resolveConfig('WS_CONNECT_TIMEOUT_MS');
  WS_BASE_RECONNECT_DELAY_MS = resolveConfig('WS_BASE_RECONNECT_DELAY_MS');
  MARKET_RESOLUTION_LOOP_MS = resolveConfig('MARKET_RESOLUTION_LOOP_MS');
  REDEMPTION_LOOP_MS = resolveConfig('REDEMPTION_LOOP_MS');
  CLOSING_WATCHDOG_LOOP_MS = resolveConfig('CLOSING_WATCHDOG_LOOP_MS');
  FORCED_EXIT_RETRY_COOLDOWN_MS = resolveConfig('FORCED_EXIT_RETRY_COOLDOWN_MS');
  SL_CONFIRMATION_MIN_WINDOW_MS = resolveConfig('SL_CONFIRMATION_MIN_WINDOW_MS');
  RESERVATION_JANITOR_LOOP_MS = resolveConfig('RESERVATION_JANITOR_LOOP_MS');
  PLACING_JANITOR_LOOP_MS = resolveConfig('PLACING_JANITOR_LOOP_MS');
  PENDING_ENTRY_JANITOR_LOOP_MS = resolveConfig('PENDING_ENTRY_JANITOR_LOOP_MS');
  STRATEGY_EVAL_INTERVAL_MS = resolveConfig('STRATEGY_EVAL_INTERVAL_MS');
  BACKEND_READY_TIMEOUT_MS = resolveConfig('BACKEND_READY_TIMEOUT_MS');
  DATA_API_PAGE_LIMIT = resolveConfig('DATA_API_PAGE_LIMIT');
  DATA_API_MAX_PAGES = resolveConfig('DATA_API_MAX_PAGES');
  PNL_TICK_THROTTLE_MS = resolveConfig('PNL_TICK_THROTTLE_MS');
  KILL_SWITCH_CHECK_INTERVAL_MS = resolveConfig('KILL_SWITCH_CHECK_INTERVAL_MS');
  MARKET_REFRESH_THROTTLE_MS = resolveConfig('MARKET_REFRESH_THROTTLE_MS');
  REAL_BALANCE_CACHE_TTL = resolveConfig('REAL_BALANCE_CACHE_TTL');
  TICK_SIZE_CACHE_TTL = resolveConfig('TICK_SIZE_CACHE_TTL');
  CLOB_ORDER_TIMEOUT_MS = resolveConfig('CLOB_ORDER_TIMEOUT_MS');
  CLOB_BOOK_FETCH_TIMEOUT_MS = resolveConfig('CLOB_BOOK_FETCH_TIMEOUT_MS');
  CLOB_AMOUNT_DECIMALS = resolveConfig('CLOB_AMOUNT_DECIMALS');
  FEE_RATE_CACHE_TTL = resolveConfig('FEE_RATE_CACHE_TTL');
  BOOK_FRESHNESS_WARN_MAX_AGE_MS = resolveConfig('BOOK_FRESHNESS_WARN_MAX_AGE_MS');
  LAST_TRADE_PRICE_MAX_AGE_MS = resolveConfig('LAST_TRADE_PRICE_MAX_AGE_MS');
}

// ── SystemConfig key mapping ──

const CONFIG_KEY_MAP: Record<WorkerConfigKey, string> = {
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
  PENDING_ENTRY_JANITOR_LOOP_MS: 'worker.pending_entry_janitor.loop_ms',
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
 * Named exports are reassigned after load so ESM live bindings pick up overrides.
 */
export async function initWorkerConfigCache(ds: DataSource): Promise<void> {
  const service = new SystemConfigService(ds);
  const all = await service.getAll();
  const dbMap = new Map(all.map((e) => [e.key, e.value]));

  for (const [constName, configKey] of Object.entries(CONFIG_KEY_MAP) as [
    WorkerConfigKey,
    string,
  ][]) {
    const dbValue = dbMap.get(configKey);
    if (dbValue !== undefined) {
      const num = Number(dbValue);
      if (Number.isFinite(num)) {
        workerConfig[constName] = num;
      }
    }
  }

  syncNamedExportsFromWorkerConfig();
}
