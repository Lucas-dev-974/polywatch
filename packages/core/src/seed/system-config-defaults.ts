import type { DataSource } from 'typeorm';
import { SystemConfig } from '../entities/SystemConfig.js';

export const SYSTEM_CONFIG_DEFAULTS: { key: string; value: string; category: string; description: string }[] = [
  // Worker timing
  { key: 'worker.heartbeat.interval_ms', value: '30000', category: 'worker', description: 'Worker heartbeat publish interval' },
  { key: 'worker.book.subscription_sync_ms', value: '10000', category: 'worker', description: 'WebSocket book subscription reconciliation interval' },
  { key: 'worker.ws.heartbeat_interval_ms', value: '10000', category: 'worker', description: 'WebSocket ping interval' },
  { key: 'worker.ws.stale_book_threshold_ms', value: '30000', category: 'worker', description: 'Book staleness threshold for REST re-sync' },
  { key: 'worker.ws.max_reconnect_attempts', value: '5', category: 'worker', description: 'Max WebSocket reconnect attempts' },
  { key: 'worker.ws.connect_timeout_ms', value: '15000', category: 'worker', description: 'WebSocket connect timeout' },
  { key: 'worker.ws.base_reconnect_delay_ms', value: '1000', category: 'worker', description: 'WebSocket reconnect backoff base delay' },
  { key: 'worker.market_resolution.loop_ms', value: '15000', category: 'worker', description: 'Market resolution watcher poll interval' },
  { key: 'worker.redemption.loop_ms', value: '15000', category: 'worker', description: 'Redemption handler poll interval' },
  { key: 'worker.closing_watchdog.loop_ms', value: '15000', category: 'worker', description: 'Closing watchdog poll interval' },
  { key: 'worker.forced_exit.retry_cooldown_ms', value: '5000', category: 'worker', description: 'Min spacing between forced exit retries' },
  { key: 'worker.sl_confirmation.min_window_ms', value: '500', category: 'worker', description: 'Min window for SL confirmation' },
  { key: 'worker.reservation_janitor.loop_ms', value: '60000', category: 'worker', description: 'Reservation janitor poll interval' },
  { key: 'worker.placing_janitor.loop_ms', value: '15000', category: 'worker', description: 'Placing janitor poll interval' },
  { key: 'worker.strategy.eval_interval_ms', value: '100', category: 'worker', description: 'Strategy evaluation loop interval' },
  { key: 'worker.backend_ready.timeout_ms', value: '60000', category: 'worker', description: 'Backend ready signal timeout' },
  { key: 'worker.data_api.page_limit', value: '500', category: 'worker', description: 'Data API page limit per request' },
  { key: 'worker.data_api.max_pages', value: '20', category: 'worker', description: 'Max pagination pages' },
  { key: 'worker.pnl_tick.throttle_ms', value: '100', category: 'worker', description: 'PnL tick throttle' },
  { key: 'worker.kill_switch.check_interval_ms', value: '10000', category: 'worker', description: 'Kill switch re-check interval' },
  { key: 'worker.market_refresh.throttle_ms', value: '15000', category: 'worker', description: 'Market lifecycle refresh throttle' },
  { key: 'worker.real_balance.cache_ttl_ms', value: '10000', category: 'worker', description: 'Real pUSD balance cache TTL' },
  { key: 'worker.tick_size.cache_ttl_ms', value: '300000', category: 'worker', description: 'Tick size cache TTL' },
  { key: 'worker.clob.order_timeout_ms', value: '30000', category: 'worker', description: 'CLOB order timeout' },
  { key: 'worker.fee_rate.cache_ttl_ms', value: '300000', category: 'worker', description: 'Fee rate cache TTL' },
  { key: 'worker.book_freshness.warn_max_age_ms', value: '30000', category: 'worker', description: 'Book staleness warning threshold' },
  { key: 'worker.last_trade_price.max_age_ms', value: '60000', category: 'worker', description: 'Last trade price staleness threshold' },
  { key: 'worker.clob.amount_decimals', value: '6', category: 'worker', description: 'CLOB amount decimals' },
  { key: 'worker.clob.position_lock_timeout_ms', value: '60000', category: 'worker', description: 'Position lock timeout' },
  { key: 'worker.circuit_breaker.failure_threshold', value: '5', category: 'worker', description: 'Circuit breaker failure threshold' },
  { key: 'worker.circuit_breaker.cooldown_ms', value: '30000', category: 'worker', description: 'Circuit breaker cooldown' },

  // Surveillance
  { key: 'surveillance.open_snapshot_delay_ms', value: '5000', category: 'surveillance', description: 'Delay before capturing open snapshot' },
  { key: 'surveillance.close_snapshot_delay_ms', value: '2000', category: 'surveillance', description: 'Delay before capturing close snapshot' },
  { key: 'surveillance.close_ttl_ms', value: '300000', category: 'surveillance', description: 'Max wait for close snapshot' },
  { key: 'surveillance.redemption_win_threshold', value: '0.99', category: 'surveillance', description: 'Price threshold for redemption win' },
  { key: 'surveillance.redemption_loss_threshold', value: '0.01', category: 'surveillance', description: 'Price threshold for redemption loss' },

  // Auto-track
  { key: 'auto_track.fetch_page_size', value: '100', category: 'auto_track', description: 'Gamma pagination page size' },
  { key: 'auto_track.max_pages', value: '6', category: 'auto_track', description: 'Max Gamma pagination pages' },
  { key: 'auto_track.sync_min_interval_ms', value: '10000', category: 'auto_track', description: 'Auto-track sync throttle' },
  { key: 'auto_track.future_markets_sync_min_interval_ms', value: '30000', category: 'auto_track', description: 'Future markets sync throttle' },
  { key: 'auto_track.janitor.short_interval_ms', value: '30000', category: 'auto_track', description: 'Janitor cadence for short intervals' },
  { key: 'auto_track.janitor.default_interval_ms', value: '60000', category: 'auto_track', description: 'Default janitor cadence' },

  // Backend cache
  { key: 'backend.cache.market_tags.ttl_ms', value: '86400000', category: 'backend', description: 'Market tags cache TTL' },
  { key: 'backend.cache.funding.ttl_ms', value: '21600000', category: 'backend', description: 'Funding cache TTL' },
  { key: 'backend.auth.refresh_token.ttl_seconds', value: '604800', category: 'backend', description: 'Refresh token TTL' },
  { key: 'backend.polygonscan.max_offset', value: '1000', category: 'backend', description: 'Polygonscan max offset' },
  { key: 'backend.polygonscan.max_windows', value: '1000', category: 'backend', description: 'Polygonscan max windows' },

  // Feature flags (P0 audit)
  {
    key: 'feature.risk_config_legacy_facade',
    value: 'true',
    category: 'feature_flag',
    description: 'Keep getConfig() / composeRiskConfig() legacy facade active (Strangler Fig)',
  },
  {
    key: 'feature.risk_config_strict',
    value: 'false',
    category: 'feature_flag',
    description: 'RiskConfig divergence guard: false = log-only, true = fail-closed (throw)',
  },
  {
    key: 'feature.deprecated_fallbacks_enabled',
    value: 'true',
    category: 'feature_flag',
    description: 'Keep deprecated constant fallbacks active; false = explicit throws',
  },
];

export async function seedSystemConfigDefaults(ds: DataSource): Promise<void> {
  const repo = ds.getRepository(SystemConfig);
  for (const entry of SYSTEM_CONFIG_DEFAULTS) {
    const existing = await repo.findOne({ where: { key: entry.key } });
    if (!existing) {
      await repo.save(repo.create({
        key: entry.key,
        value: entry.value,
        category: entry.category,
        description: entry.description,
      }));
    }
  }
}
