import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { DEFAULT_SIM_BALANCE } from '../simulation/constants.js';

@Entity('crypto_config')
export class CryptoConfig {
  @PrimaryGeneratedColumn()
  id!: number;

  // ── Friction: position limits (crypto-algo prefixed) ──────────────

  @Column({ type: 'integer', name: 'crypto_algo_max_open_positions', default: 10 })
  cryptoAlgoMaxOpenPositions!: number;

  @Column({ type: 'real', name: 'crypto_algo_max_exposure_pusd', default: 1000 })
  cryptoAlgoMaxExposurePusd!: number;

  @Column({ type: 'real', name: 'crypto_algo_max_daily_loss_pusd', default: 100 })
  cryptoAlgoMaxDailyLossPusd!: number;

  @Column({ type: 'real', name: 'crypto_algo_max_position_size_pusd', default: 200 })
  cryptoAlgoMaxPositionSizePusd!: number;

  // ── SL confirmation ticks ─────────────────────────────────────────

  @Column({ type: 'integer', name: 'crypto_algo_sl_confirmation_ticks', default: 2 })
  cryptoAlgoSlConfirmationTicks!: number;

  // ── Kill switch ───────────────────────────────────────────────────

  @Column({ type: 'text', name: 'crypto_algo_kill_switch_action', default: 'block_entries' })
  cryptoAlgoKillSwitchAction!: string;

  // ── Min bid/ask ratio (dead — unused by crypto-algo; kept for DB compat) ─

  @Column({ type: 'real', name: 'crypto_algo_min_bid_to_ask_ratio', default: 0.9 })
  cryptoAlgoMinBidToAskRatio!: number;

  // ── Entry depth retry ─────────────────────────────────────────────

  @Column({ type: 'integer', name: 'crypto_algo_entry_depth_retry_max', default: 3 })
  cryptoAlgoEntryDepthRetryMax!: number;

  @Column({ type: 'integer', name: 'crypto_algo_entry_depth_retry_delay_ms', default: 1000 })
  cryptoAlgoEntryDepthRetryDelayMs!: number;

  // ── SL close max retries ──────────────────────────────────────────

  @Column({ type: 'integer', name: 'crypto_algo_sl_close_max_retries', default: 5 })
  cryptoAlgoSlCloseMaxRetries!: number;

  // ── Min time to close ─────────────────────────────────────────────

  @Column({ type: 'integer', name: 'crypto_algo_min_time_to_close', nullable: true })
  cryptoAlgoMinTimeToClose!: number | null;

  // ── Allowed market tags (dead — serialized in API only, no filter) ─

  @Column({ type: 'text', name: 'crypto_algo_allowed_market_tags', default: '[]' })
  cryptoAlgoAllowedMarketTags!: string;

  // ── Signal score sizing (dead — sizing hardcodes false) ───────────

  @Column({ type: 'boolean', name: 'crypto_algo_signal_score_sizing_enabled', default: true })
  cryptoAlgoSignalScoreSizingEnabled!: boolean;

  // ── Master toggle ─────────────────────────────────────────────────

  @Column({ type: 'boolean', name: 'crypto_algo_enabled', default: false })
  cryptoAlgoEnabled!: boolean;

  // ── Market recording & listening toggle ───────────────────────────

  @Column({
    type: 'boolean',
    name: 'crypto_algo_recording_enabled',
    default: true,
  })
  cryptoAlgoRecordingEnabled!: boolean;

  // ── Price tick cleanup ────────────────────────────────────────────

  @Column({ type: 'boolean', name: 'crypto_algo_price_tick_cleanup_enabled', default: false })
  cryptoAlgoPriceTickCleanupEnabled!: boolean;

  @Column({ type: 'integer', name: 'crypto_algo_price_tick_cleanup_interval_minutes', default: 60 })
  cryptoAlgoPriceTickCleanupIntervalMinutes!: number;

  // ── Strategies ────────────────────────────────────────────────────

  @Column({ type: 'text', name: 'crypto_algo_strategies', default: '["naive-momentum"]' })
  cryptoAlgoStrategies!: string;

  /**
   * Per-strategy JSON bag: `{ [strategyId]: { minTimeToClose?, exitProfile?, ... } }`.
   * Empty object `{}` = no overrides.
   */
  @Column({ type: 'text', name: 'crypto_algo_strategy_params', default: '{}' })
  cryptoAlgoStrategyParams!: string;

  // ── Trailing ──────────────────────────────────────────────────────

  @Column({ type: 'real', name: 'crypto_algo_trailing_percent', nullable: true })
  cryptoAlgoTrailingPercent!: number | null;

  @Column({ type: 'real', name: 'crypto_algo_trailing_activation_percent', nullable: true })
  cryptoAlgoTrailingActivationPercent!: number | null;

  // ── Pre-close ─────────────────────────────────────────────────────

  @Column({ type: 'boolean', name: 'crypto_algo_pre_close_enabled', nullable: true })
  cryptoAlgoPreCloseEnabled!: boolean | null;

  @Column({ type: 'integer', name: 'crypto_algo_pre_close_seconds', nullable: true })
  cryptoAlgoPreCloseSeconds!: number | null;

  @Column({ type: 'boolean', name: 'crypto_algo_pre_close_keep_enabled', nullable: true })
  cryptoAlgoPreCloseKeepEnabled!: boolean | null;

  @Column({ type: 'real', name: 'crypto_algo_pre_close_keep_bid_threshold', nullable: true })
  cryptoAlgoPreCloseKeepBidThreshold!: number | null;

  // ── SL/TP toggles ──────────────────────────────────────────────────

  @Column({ type: 'boolean', name: 'crypto_algo_sl_enabled', default: false })
  cryptoAlgoSlEnabled!: boolean;

  @Column({ type: 'boolean', name: 'crypto_algo_tp_enabled', default: true })
  cryptoAlgoTpEnabled!: boolean;

  @Column({ type: 'boolean', name: 'crypto_algo_trailing_enabled', default: true })
  cryptoAlgoTrailingEnabled!: boolean;

  // ── SL/TP percent ────────────────────────────────────────────────

  @Column({ type: 'real', name: 'crypto_algo_sl_percent', nullable: true })
  cryptoAlgoSlPercent!: number | null;

  @Column({ type: 'real', name: 'crypto_algo_tp_percent', nullable: true })
  cryptoAlgoTpPercent!: number | null;

  // ── Re-entry throttle ─────────────────────────────────────────────

  @Column({ type: 'integer', name: 'crypto_algo_reentry_window_ms', nullable: true })
  cryptoAlgoReentryWindowMs!: number | null;

  @Column({ type: 'integer', name: 'crypto_algo_max_entries_per_window', nullable: true })
  cryptoAlgoMaxEntriesPerWindow!: number | null;

  // ── Naive-momentum thresholds ─────────────────────────────────────

  @Column({ type: 'real', name: 'crypto_algo_base_threshold', nullable: true })
  cryptoAlgoBaseThreshold!: number | null;

  @Column({ type: 'real', name: 'crypto_algo_spread_adjustment_factor', nullable: true })
  cryptoAlgoSpreadAdjustmentFactor!: number | null;

  @Column({ type: 'real', name: 'crypto_algo_min_spread_abs_for_adjustment', nullable: true })
  cryptoAlgoMinSpreadAbsForAdjustment!: number | null;

  @Column({ type: 'real', name: 'crypto_algo_max_spread_abs', nullable: true })
  cryptoAlgoMaxSpreadAbs!: number | null;

  @Column({ type: 'real', name: 'crypto_algo_price_sum_tolerance', nullable: true })
  cryptoAlgoPriceSumTolerance!: number | null;

  @Column({ type: 'real', name: 'crypto_algo_warn_price_deviation', nullable: true })
  cryptoAlgoWarnPriceDeviation!: number | null;

  // ── Book / cache / polling ────────────────────────────────────────

  @Column({ type: 'integer', name: 'crypto_algo_max_book_age_ms', nullable: true })
  cryptoAlgoMaxBookAgeMs!: number | null;

  @Column({ type: 'integer', name: 'crypto_algo_gamma_cache_ttl_short_ms', nullable: true })
  cryptoAlgoGammaCacheTtlShortMs!: number | null;

  @Column({ type: 'integer', name: 'crypto_algo_gamma_cache_ttl_default_ms', nullable: true })
  cryptoAlgoGammaCacheTtlDefaultMs!: number | null;

  @Column({ type: 'real', name: 'crypto_algo_gamma_stale_on_error_factor', nullable: true })
  cryptoAlgoGammaStaleOnErrorFactor!: number | null;

  @Column({ type: 'integer', name: 'crypto_algo_ws_debounce_ms', nullable: true })
  cryptoAlgoWsDebounceMs!: number | null;

  @Column({ type: 'integer', name: 'crypto_algo_poll_ms', nullable: true })
  cryptoAlgoPollMs!: number | null;

  // ── Price tick recording ──────────────────────────────────────────

  @Column({ type: 'integer', name: 'crypto_algo_tick_interval_ms', nullable: true })
  cryptoAlgoTickIntervalMs!: number | null;

  @Column({ type: 'integer', name: 'crypto_algo_tick_retention_hours', nullable: true })
  cryptoAlgoTickRetentionHours!: number | null;

  @Column({ type: 'real', name: 'crypto_algo_price_tick_ref_qty', nullable: true })
  cryptoAlgoPriceTickRefQty!: number | null;

  // ── Time-to-close buffer ──────────────────────────────────────────

  @Column({ type: 'integer', name: 'crypto_algo_min_time_to_close_buffer_seconds', nullable: true })
  cryptoAlgoMinTimeToCloseBufferSeconds!: number | null;

  @Column({ type: 'integer', name: 'crypto_algo_last_closeable_bid_max_age_ms', nullable: true })
  cryptoAlgoLastCloseableBidMaxAgeMs!: number | null;

  // ── JSON overrides ────────────────────────────────────────────────

  @Column({ type: 'text', name: 'crypto_algo_spread_abs_by_interval', nullable: true })
  cryptoAlgoSpreadAbsByInterval!: string | null;

  @Column({ type: 'text', name: 'crypto_algo_exit_defaults_by_interval', nullable: true })
  cryptoAlgoExitDefaultsByInterval!: string | null;

  @Column({ type: 'text', name: 'crypto_algo_pre_close_seconds_by_interval', nullable: true })
  cryptoAlgoPreCloseSecondsByInterval!: string | null;

  // ── SL quota ──────────────────────────────────────────────────────

  @Column({ type: 'boolean', name: 'crypto_algo_sl_quota_enabled', default: false })
  cryptoAlgoSlQuotaEnabled!: boolean;

  @Column({ type: 'integer', name: 'crypto_algo_sl_quota_per_market', default: 1 })
  cryptoAlgoSlQuotaPerMarket!: number;

  @Column({ type: 'integer', name: 'crypto_algo_sl_quota_cache_ttl_seconds', default: 30 })
  cryptoAlgoSlQuotaCacheTtlSeconds!: number;

  // ── Entry price band ───────────────────────────────────────────────

  @Column({ type: 'real', name: 'crypto_algo_entry_price_min', nullable: true })
  cryptoAlgoEntryPriceMin!: number | null;

  @Column({ type: 'real', name: 'crypto_algo_entry_price_max', nullable: true })
  cryptoAlgoEntryPriceMax!: number | null;

  @Column({ type: 'boolean', name: 'crypto_algo_entry_price_band_enabled', nullable: true })
  cryptoAlgoEntryPriceBandEnabled!: boolean | null;

  // ── Curve filter ──────────────────────────────────────────────────

  @Column({ type: 'boolean', name: 'crypto_algo_curve_filter_enabled', nullable: true })
  cryptoAlgoCurveFilterEnabled!: boolean | null;

  @Column({ type: 'integer', name: 'crypto_algo_curve_lookback_ms', nullable: true })
  cryptoAlgoCurveLookbackMs!: number | null;

  @Column({ type: 'real', name: 'crypto_algo_curve_min_delta', nullable: true })
  cryptoAlgoCurveMinDelta!: number | null;

  // ── Sizing ────────────────────────────────────────────────────────

  @Column({ type: 'text', name: 'crypto_algo_sizing_mode', default: 'fixed_pusd' })
  cryptoAlgoSizingMode!: string;

  @Column({ type: 'real', name: 'crypto_algo_entry_pusd_amount', default: 10 })
  cryptoAlgoEntryPusdAmount!: number;

  @Column({ type: 'real', name: 'crypto_algo_entry_share_count', nullable: true })
  cryptoAlgoEntryShareCount!: number | null;

  // ── Sim initial capital (crypto) ──────────────────────────────────

  @Column({
    type: 'real',
    name: 'sim_initial_capital_crypto',
    default: DEFAULT_SIM_BALANCE,
  })
  simInitialCapitalCrypto!: number;
}
