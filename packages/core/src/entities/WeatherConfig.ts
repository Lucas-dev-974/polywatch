import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { DEFAULT_SIM_BALANCE } from '../simulation/constants.js';

@Entity('weather_config')
export class WeatherConfig {
  @PrimaryGeneratedColumn()
  id!: number;

  // ── Friction: position limits (weather-algo prefixed) ─────────────

  @Column({ type: 'integer', name: 'weather_algo_max_open_positions', default: 10 })
  weatherAlgoMaxOpenPositions!: number;

  @Column({ type: 'real', name: 'weather_algo_max_exposure_usdc', default: 1000 })
  weatherAlgoMaxExposureUsdc!: number;

  @Column({ type: 'real', name: 'weather_algo_max_daily_loss_usdc', default: 100 })
  weatherAlgoMaxDailyLossUsdc!: number;

  @Column({ type: 'real', name: 'weather_algo_max_position_size_usdc', default: 200 })
  weatherAlgoMaxPositionSizeUsdc!: number;

  // ── SL confirmation ticks ─────────────────────────────────────────

  @Column({ type: 'integer', name: 'weather_algo_sl_confirmation_ticks', default: 2 })
  weatherAlgoSlConfirmationTicks!: number;

  // ── Kill switch ───────────────────────────────────────────────────

  @Column({ type: 'text', name: 'weather_algo_kill_switch_action', default: 'block_entries' })
  weatherAlgoKillSwitchAction!: string;

  // ── Min bid/ask ratio ─────────────────────────────────────────────

  @Column({ type: 'real', name: 'weather_algo_min_bid_to_ask_ratio', default: 0.9 })
  weatherAlgoMinBidToAskRatio!: number;

  // ── Entry depth retry ─────────────────────────────────────────────

  @Column({ type: 'integer', name: 'weather_algo_entry_depth_retry_max', default: 3 })
  weatherAlgoEntryDepthRetryMax!: number;

  @Column({ type: 'integer', name: 'weather_algo_entry_depth_retry_delay_ms', default: 1000 })
  weatherAlgoEntryDepthRetryDelayMs!: number;

  // ── SL close max retries ──────────────────────────────────────────

  @Column({ type: 'integer', name: 'weather_algo_sl_close_max_retries', default: 5 })
  weatherAlgoSlCloseMaxRetries!: number;

  // ── Min time to close ─────────────────────────────────────────────

  @Column({ type: 'integer', name: 'weather_algo_min_time_to_close', default: 0 })
  weatherAlgoMinTimeToClose!: number;

  // ── Allowed market tags ───────────────────────────────────────────

  @Column({ type: 'text', name: 'weather_algo_allowed_market_tags', default: '[]' })
  weatherAlgoAllowedMarketTags!: string;

  // ── Signal score sizing ───────────────────────────────────────────

  @Column({ type: 'boolean', name: 'weather_algo_signal_score_sizing_enabled', default: true })
  weatherAlgoSignalScoreSizingEnabled!: boolean;

  // ── SL/TP/Trailing toggles (weather) ──────────────────────────────

  @Column({ type: 'boolean', name: 'weather_algo_sl_enabled', default: true })
  weatherAlgoSlEnabled!: boolean;

  @Column({ type: 'boolean', name: 'weather_algo_tp_enabled', default: true })
  weatherAlgoTpEnabled!: boolean;

  @Column({ type: 'boolean', name: 'weather_algo_trailing_enabled', default: true })
  weatherAlgoTrailingEnabled!: boolean;

  // ── Master toggles ────────────────────────────────────────────────

  @Column({ type: 'boolean', name: 'weather_algo_enabled', default: false })
  weatherAlgoEnabled!: boolean;

  @Column({ type: 'boolean', name: 'weather_algo_sim_enabled', default: true })
  weatherAlgoSimEnabled!: boolean;

  @Column({ type: 'boolean', name: 'weather_algo_real_enabled', default: false })
  weatherAlgoRealEnabled!: boolean;

  // ── Entry gating ──────────────────────────────────────────────────

  @Column({ type: 'real', name: 'weather_algo_min_edge', default: 0.10 })
  weatherAlgoMinEdge!: number;

  @Column({ type: 'real', name: 'weather_algo_max_forecast_std', nullable: true })
  weatherAlgoMaxForecastStd!: number | null;

  /**
   * Minimum forecast-implied YES probability required to emit a signal.
   * Filters out long-shot buckets where forecastProb is low (e.g. 0.15) but
   * the probability edge passes `weatherAlgoMinEdge`. Such buckets have a
   * structurally low win rate even when the edge is positive. Null disables
   * the filter (legacy behavior). Default 0.30 keeps buckets with a real
   * directional thesis (≈ "likely YES").
   */
  @Column({ type: 'real', name: 'weather_algo_min_forecast_probability', nullable: true })
  weatherAlgoMinForecastProbability!: number | null;

  // ── Sizing ────────────────────────────────────────────────────────

  @Column({ type: 'text', name: 'weather_algo_sizing_mode', default: 'fixed_usdc' })
  weatherAlgoSizingMode!: string;

  @Column({ type: 'real', name: 'weather_algo_entry_usdc', default: 10 })
  weatherAlgoEntryUsdc!: number;

  @Column({ type: 'integer', name: 'weather_algo_entry_share_count', default: 100 })
  weatherAlgoEntryShareCount!: number;

  // ── Selection ──────────────────────────────────────────────────────

  @Column({ type: 'text', name: 'weather_algo_selection_mode', default: 'single' })
  weatherAlgoSelectionMode!: string;

  @Column({ type: 'integer', name: 'weather_algo_max_signals_per_event', default: 3 })
  weatherAlgoMaxSignalsPerEvent!: number;

  // ── Position management ───────────────────────────────────────────

  @Column({ type: 'real', name: 'weather_algo_forecast_change_threshold', default: 2 })
  weatherAlgoForecastChangeThreshold!: number;

  // ── Polling ───────────────────────────────────────────────────────

  @Column({ type: 'integer', name: 'weather_algo_poll_ms', default: 1800000 })
  weatherAlgoPollMs!: number;

  // ── City follow ────────────────────────────────────────────────────

  @Column({ type: 'text', name: 'weather_algo_city_follow_switch_mode', default: 'close_and_reenter' })
  weatherAlgoCityFollowSwitchMode!: string;

  /** Consecutive out-of-bucket polls before WEATHER_BUCKET_EXIT (close_and_reenter). */
  @Column({ type: 'integer', name: 'weather_algo_bucket_hysteresis_polls', default: 2 })
  weatherAlgoBucketHysteresisPolls!: number;

  /** Pause after bucket/drift close before re-entering the same city. */
  @Column({ type: 'integer', name: 'weather_algo_reentry_throttle_ms', default: 1800000 })
  weatherAlgoReentryThrottleMs!: number;

  // ── Sim initial capital (weather) ─────────────────────────────────

  @Column({
    type: 'real',
    name: 'sim_initial_capital_weather',
    default: DEFAULT_SIM_BALANCE,
  })
  simInitialCapitalWeather!: number;

  // ── Backtest data recording ───────────────────────────────────────

  @Column({
    type: 'boolean',
    name: 'weather_algo_forecast_history_recording_enabled',
    default: true,
  })
  weatherAlgoForecastHistoryRecordingEnabled!: boolean;

  @Column({
    type: 'boolean',
    name: 'weather_algo_market_snapshot_recording_enabled',
    default: true,
  })
  weatherAlgoMarketSnapshotRecordingEnabled!: boolean;

  @Column({
    type: 'boolean',
    name: 'weather_algo_evaluation_log_recording_enabled',
    default: true,
  })
  weatherAlgoEvaluationLogRecordingEnabled!: boolean;

  @Column({
    type: 'integer',
    name: 'weather_algo_forecast_history_retention_days',
    default: 90,
  })
  weatherAlgoForecastHistoryRetentionDays!: number;

  @Column({
    type: 'integer',
    name: 'weather_algo_market_snapshot_retention_days',
    default: 30,
  })
  weatherAlgoMarketSnapshotRetentionDays!: number;

  @Column({
    type: 'integer',
    name: 'weather_algo_evaluation_log_retention_days',
    default: 90,
  })
  weatherAlgoEvaluationLogRetentionDays!: number;

  // ── Multi-strategy ─────────────────────────────────────────────────

  /** JSON array of active strategy IDs, e.g. `["weather-forecast"]`. */
  @Column({ type: 'text', name: 'weather_algo_strategies', default: '["weather-forecast"]' })
  weatherAlgoStrategies!: string;

  /** JSON object of per-strategy params, e.g. `{ "weather-forecast": { ... } }`. */
  @Column({ type: 'text', name: 'weather_algo_strategy_params', default: '{}' })
  weatherAlgoStrategyParams!: string;
}
