import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { DEFAULT_SIM_BALANCE } from '../simulation/constants.js';

@Entity('risk_config')
export class RiskConfig {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'integer', name: 'sim_max_open_positions', default: 10 })
  simMaxOpenPositions!: number;

  @Column({ type: 'integer', name: 'real_max_open_positions', default: 10 })
  realMaxOpenPositions!: number;

  @Column({ type: 'real', name: 'max_exposure_usdc', default: 1000 })
  maxExposureUsdc!: number;

  @Column({ type: 'real', name: 'max_daily_loss_usdc', default: 100 })
  maxDailyLossUsdc!: number;

  @Column({ type: 'real', name: 'max_position_size_usdc', default: 200 })
  maxPositionSizeUsdc!: number;

  @Column({ type: 'real', name: 'max_slippage_percent', default: 2 })
  maxSlippagePercent!: number;

  /** Min executable bid/ask VWAP ratio required before copy entry (0 = off). */
  @Column({ type: 'real', name: 'sim_min_bid_to_ask_ratio', default: 0.9 })
  simMinBidToAskRatio!: number;

  @Column({ type: 'real', name: 'real_min_bid_to_ask_ratio', default: 0.9 })
  realMinBidToAskRatio!: number;

  /**
   * Momentum entry filter: refuse to copy an entry when the executable ask VWAP
   * is below the trader's average price (position already under water). Fails
   * open when the trader avg price is unavailable (≤ 0). Off by default.
   */
  @Column({
    type: 'boolean',
    name: 'sim_momentum_filter_enabled',
    default: false,
  })
  simMomentumFilterEnabled!: boolean;

  @Column({
    type: 'boolean',
    name: 'real_momentum_filter_enabled',
    default: false,
  })
  realMomentumFilterEnabled!: boolean;

  @Column({ type: 'real', name: 'exit_slippage_guard_percent', default: 50 })
  exitSlippageGuardPercent!: number;

  @Column({ type: 'integer', name: 'pre_close_seconds', default: 60 })
  preCloseSeconds!: number;

  @Column({ type: 'text', name: 'kill_switch_action', default: 'block_entries' })
  killSwitchAction!: string;

  @Column({ type: 'boolean', name: 'real_trading_enabled', default: false })
  realTradingEnabled!: boolean;

  /** Master toggle for sim-mode copy trading entries (COPY_OPEN / COPY_INCREASE). */
  @Column({ type: 'boolean', name: 'sim_copy_trading_enabled', default: true })
  simCopyTradingEnabled!: boolean;

  /** Master toggle for real-mode copy trading entries (COPY_OPEN / COPY_INCREASE). */
  @Column({ type: 'boolean', name: 'real_copy_trading_enabled', default: true })
  realCopyTradingEnabled!: boolean;

  @Column({ type: 'text', name: 'sim_sizing_mode', default: 'fixed_usdc' })
  simSizingMode!: string;

  @Column({ type: 'real', name: 'sim_copy_ratio', default: 1.0 })
  simCopyRatio!: number;

  @Column({ type: 'real', name: 'sim_entry_usdc_amount', default: 10 })
  simEntryUsdcAmount!: number;

  @Column({ type: 'integer', name: 'sim_entry_share_count', default: 5 })
  simEntryShareCount!: number;

  @Column({ type: 'real', name: 'sim_kelly_fraction', default: 0.25 })
  simKellyFraction!: number;

  @Column({ type: 'real', name: 'sim_risk_budget_usdc', default: 10 })
  simRiskBudgetUsdc!: number;

  @Column({ type: 'real', name: 'sim_default_win_probability', default: 0.55 })
  simDefaultWinProbability!: number;

  @Column({
    type: 'real',
    name: 'sim_initial_capital',
    default: DEFAULT_SIM_BALANCE,
  })
  /** @deprecated Use simInitialCapitalCrypto — kept for DB compat only. */
  simInitialCapital!: number;

  @Column({
    type: 'real',
    name: 'sim_initial_capital_crypto',
    default: DEFAULT_SIM_BALANCE,
  })
  simInitialCapitalCrypto!: number;

  @Column({
    type: 'real',
    name: 'sim_initial_capital_weather',
    default: DEFAULT_SIM_BALANCE,
  })
  simInitialCapitalWeather!: number;

  @Column({
    type: 'real',
    name: 'sim_initial_capital_copy',
    default: DEFAULT_SIM_BALANCE,
  })
  simInitialCapitalCopy!: number;

  @Column({ type: 'text', name: 'real_sizing_mode', default: 'fixed_usdc' })
  realSizingMode!: string;

  @Column({ type: 'real', name: 'real_copy_ratio', default: 1.0 })
  realCopyRatio!: number;

  @Column({ type: 'real', name: 'real_entry_usdc_amount', default: 10 })
  realEntryUsdcAmount!: number;

  @Column({ type: 'integer', name: 'real_entry_share_count', default: 5 })
  realEntryShareCount!: number;

  @Column({ type: 'real', name: 'real_kelly_fraction', default: 0.25 })
  realKellyFraction!: number;

  @Column({ type: 'real', name: 'real_risk_budget_usdc', default: 10 })
  realRiskBudgetUsdc!: number;

  @Column({ type: 'real', name: 'real_default_win_probability', default: 0.55 })
  realDefaultWinProbability!: number;

  @Column({ type: 'boolean', name: 'sim_trailing_enabled', default: true })
  simTrailingEnabled!: boolean;

  @Column({ type: 'real', name: 'sim_trailing_bid_points', default: 0.05 })
  simTrailingBidPoints!: number;

  @Column({ type: 'real', name: 'sim_trailing_activation_bid_points', default: 0.06 })
  simTrailingActivationBidPoints!: number;

  @Column({ type: 'boolean', name: 'real_trailing_enabled', default: true })
  realTrailingEnabled!: boolean;

  @Column({ type: 'real', name: 'real_trailing_bid_points', default: 0.05 })
  realTrailingBidPoints!: number;

  @Column({ type: 'real', name: 'real_trailing_activation_bid_points', default: 0.06 })
  realTrailingActivationBidPoints!: number;

  @Column({ type: 'boolean', name: 'sim_sl_enabled', default: true })
  simSlEnabled!: boolean;

  @Column({ type: 'boolean', name: 'sim_tp_enabled', default: true })
  simTpEnabled!: boolean;

  @Column({ type: 'boolean', name: 'real_sl_enabled', default: true })
  realSlEnabled!: boolean;

  @Column({ type: 'boolean', name: 'real_tp_enabled', default: true })
  realTpEnabled!: boolean;

  /** Stop-loss in bid points (absolute) for copy trading on binary markets. */
  @Column({ type: 'real', name: 'sim_sl_bid_points', default: 0.10 })
  simSlBidPoints!: number;

  /** Take-profit in bid points (absolute) for copy trading on binary markets. */
  @Column({ type: 'real', name: 'sim_tp_bid_points', default: 0.12 })
  simTpBidPoints!: number;

  /** Stop-loss in bid points (absolute) for real-mode copy trading on binary markets. */
  @Column({ type: 'real', name: 'real_sl_bid_points', default: 0.10 })
  realSlBidPoints!: number;

  /** Take-profit in bid points (absolute) for real-mode copy trading on binary markets. */
  @Column({ type: 'real', name: 'real_tp_bid_points', default: 0.12 })
  realTpBidPoints!: number;

  @Column({ type: 'integer', name: 'sim_sl_close_max_retries', default: 5 })
  simSlCloseMaxRetries!: number;

  @Column({ type: 'integer', name: 'real_sl_close_max_retries', default: 5 })
  realSlCloseMaxRetries!: number;

  /** Retries when ask depth is below target entry quantity (after first check). */
  @Column({ type: 'integer', name: 'sim_entry_depth_retry_max', default: 3 })
  simEntryDepthRetryMax!: number;

  @Column({ type: 'integer', name: 'sim_entry_depth_retry_delay_ms', default: 1000 })
  simEntryDepthRetryDelayMs!: number;

  @Column({ type: 'integer', name: 'real_entry_depth_retry_max', default: 3 })
  realEntryDepthRetryMax!: number;

  @Column({ type: 'integer', name: 'real_entry_depth_retry_delay_ms', default: 1000 })
  realEntryDepthRetryDelayMs!: number;

  @Column({ type: 'boolean', name: 'pre_close_enabled', default: true })
  preCloseEnabled!: boolean;

  @Column({ type: 'boolean', name: 'copy_increase_enabled', default: true })
  copyIncreaseEnabled!: boolean;

  @Column({ type: 'boolean', name: 'copy_decrease_enabled', default: true })
  copyDecreaseEnabled!: boolean;

  @Column({ type: 'integer', name: 'max_increases_per_position', default: 0 })
  maxIncreasesPerPosition!: number;

  @Column({ type: 'real', name: 'sim_max_position_size_usdc', default: 200 })
  simMaxPositionSizeUsdc!: number;

  @Column({ type: 'real', name: 'real_max_position_size_usdc', default: 200 })
  realMaxPositionSizeUsdc!: number;

  @Column({ type: 'real', name: 'sim_max_exposure_usdc', default: 1000 })
  simMaxExposureUsdc!: number;

  @Column({ type: 'real', name: 'real_max_exposure_usdc', default: 1000 })
  realMaxExposureUsdc!: number;

  @Column({ type: 'real', name: 'sim_max_daily_loss_usdc', default: 100 })
  simMaxDailyLossUsdc!: number;

  @Column({ type: 'real', name: 'real_max_daily_loss_usdc', default: 100 })
  realMaxDailyLossUsdc!: number;

  @Column({ type: 'text', name: 'sim_kill_switch_action', default: 'block_entries' })
  simKillSwitchAction!: string;

  @Column({ type: 'text', name: 'real_kill_switch_action', default: 'block_entries' })
  realKillSwitchAction!: string;

  @Column({ type: 'boolean', name: 'sim_copy_increase_enabled', default: true })
  simCopyIncreaseEnabled!: boolean;

  @Column({ type: 'boolean', name: 'real_copy_increase_enabled', default: true })
  realCopyIncreaseEnabled!: boolean;

  @Column({ type: 'boolean', name: 'sim_copy_decrease_enabled', default: true })
  simCopyDecreaseEnabled!: boolean;

  @Column({ type: 'boolean', name: 'real_copy_decrease_enabled', default: true })
  realCopyDecreaseEnabled!: boolean;

  @Column({ type: 'integer', name: 'sim_max_increases_per_position', default: 1 })
  simMaxIncreasesPerPosition!: number;

  @Column({ type: 'integer', name: 'real_max_increases_per_position', default: 0 })
  realMaxIncreasesPerPosition!: number;

  /**
   * When enabled, COPY_INCREASE signals are rejected if the existing position is
   * already close to its configured SL threshold.
   */
  @Column({
    type: 'boolean',
    name: 'sim_copy_increase_sl_proximity_enabled',
    default: true,
  })
  simCopyIncreaseSlProximityEnabled!: boolean;

  @Column({
    type: 'boolean',
    name: 'real_copy_increase_sl_proximity_enabled',
    default: false,
  })
  realCopyIncreaseSlProximityEnabled!: boolean;

  /**
   * COPY_INCREASE is blocked when the position's closure PnL has reached this
   * percentage of the configured SL distance (e.g. 80 means block when loss is
   * already > 80% of the SL threshold). Range 0..100.
   */
  @Column({
    type: 'real',
    name: 'sim_copy_increase_sl_proximity_percent',
    default: 80,
  })
  simCopyIncreaseSlProximityPercent!: number;

  @Column({
    type: 'real',
    name: 'real_copy_increase_sl_proximity_percent',
    default: 80,
  })
  realCopyIncreaseSlProximityPercent!: number;

  @Column({ type: 'boolean', name: 'sim_pre_close_enabled', default: true })
  simPreCloseEnabled!: boolean;

  @Column({ type: 'boolean', name: 'real_pre_close_enabled', default: true })
  realPreCloseEnabled!: boolean;

  @Column({ type: 'integer', name: 'sim_pre_close_seconds', default: 60 })
  simPreCloseSeconds!: number;

  @Column({ type: 'integer', name: 'real_pre_close_seconds', default: 60 })
  realPreCloseSeconds!: number;

  @Column({ type: 'integer', name: 'sim_min_time_to_close', default: 0 })
  simMinTimeToClose!: number;

  @Column({ type: 'integer', name: 'real_min_time_to_close', default: 0 })
  realMinTimeToClose!: number;

  @Column({ type: 'boolean', name: 'sim_pre_close_keep_enabled', default: false })
  simPreCloseKeepEnabled!: boolean;

  @Column({ type: 'real', name: 'sim_pre_close_keep_bid_threshold', default: 0.80 })
  simPreCloseKeepBidThreshold!: number;

  @Column({ type: 'boolean', name: 'real_pre_close_keep_enabled', default: false })
  realPreCloseKeepEnabled!: boolean;

  @Column({ type: 'real', name: 'real_pre_close_keep_bid_threshold', default: 0.80 })
  realPreCloseKeepBidThreshold!: number;

  @Column({ type: 'text', name: 'sim_allowed_market_tags', default: '[]' })
  simAllowedMarketTags!: string;

  @Column({ type: 'text', name: 'real_allowed_market_tags', default: '[]' })
  realAllowedMarketTags!: string;

  /** When true, entry size is scaled (and gated) by signal quality score. */
  @Column({ type: 'boolean', name: 'sim_signal_score_sizing_enabled', default: true })
  simSignalScoreSizingEnabled!: boolean;

  @Column({ type: 'boolean', name: 'real_signal_score_sizing_enabled', default: true })
  realSignalScoreSizingEnabled!: boolean;

  @Column({ type: 'boolean', name: 'sim_auto_snapshot_enabled', default: false })
  simAutoSnapshotEnabled!: boolean;

  /** Interval between automatic simulation snapshots (seconds). Min 60 when enabled. */
  @Column({ type: 'integer', name: 'sim_auto_snapshot_interval_seconds', default: 3600 })
  simAutoSnapshotIntervalSeconds!: number;

  /** Maximum number of snapshots to retain (oldest pruned first). Null = unlimited. */
  @Column({ type: 'integer', name: 'sim_snapshot_max_count', nullable: true })
  simSnapshotMaxCount!: number | null;

  /** Delete snapshots older than this many days. Null = no age-based pruning. */
  @Column({ type: 'integer', name: 'sim_snapshot_retention_days', nullable: true })
  simSnapshotRetentionDays!: number | null;

  /** When true, auto snapshots are created even with no positions or executions. */
  @Column({ type: 'boolean', name: 'sim_auto_snapshot_empty_session', default: false })
  simAutoSnapshotEmptySession!: boolean;

  /** Hours of exit/move events included in simulation snapshot decision payloads. */
  @Column({ type: 'integer', name: 'sim_snapshot_decision_window_hours', default: 24 })
  simSnapshotDecisionWindowHours!: number;

  @Column({ type: 'boolean', name: 'real_auto_snapshot_enabled', default: false })
  realAutoSnapshotEnabled!: boolean;

  /** Interval between automatic real snapshots (seconds). Min 60 when enabled. */
  @Column({ type: 'integer', name: 'real_auto_snapshot_interval_seconds', default: 3600 })
  realAutoSnapshotIntervalSeconds!: number;

  /** Maximum number of real snapshots to retain (oldest pruned first). Null = unlimited. */
  @Column({ type: 'integer', name: 'real_snapshot_max_count', nullable: true })
  realSnapshotMaxCount!: number | null;

  /** Delete real snapshots older than this many days. Null = no age-based pruning. */
  @Column({ type: 'integer', name: 'real_snapshot_retention_days', nullable: true })
  realSnapshotRetentionDays!: number | null;

  /** Hours of exit/move events included in real snapshot decision payloads. */
  @Column({ type: 'integer', name: 'real_snapshot_decision_window_hours', default: 24 })
  realSnapshotDecisionWindowHours!: number;

  /** Interval between MoveDetector poll cycles (milliseconds). */
  @Column({ type: 'integer', name: 'move_detector_interval_ms', default: 2_000 })
  moveDetectorIntervalMs!: number;

  /** Master toggle for the crypto-algo execution layer. */
  @Column({ type: 'boolean', name: 'crypto_algo_enabled', default: false })
  cryptoAlgoEnabled!: boolean;

  /** Enable periodic cleanup of old algo price ticks. Default: true. */
  @Column({ type: 'boolean', name: 'crypto_algo_price_tick_cleanup_enabled', default: true })
  cryptoAlgoPriceTickCleanupEnabled!: boolean;

  /** Interval between price tick cleanup cycles (minutes). Default: 60 (1h). */
  @Column({ type: 'integer', name: 'crypto_algo_price_tick_cleanup_interval_minutes', default: 60 })
  cryptoAlgoPriceTickCleanupIntervalMinutes!: number;

  /** JSON array of enabled crypto-algo strategy ids. */
  @Column({ type: 'text', name: 'crypto_algo_strategies', default: '["naive-momentum"]' })
  cryptoAlgoStrategies!: string;

  /** Crypto-algo trailing stop in bid points (absolute). Null = inherit interval default. */
  @Column({ type: 'real', name: 'crypto_algo_trailing_bid_points', nullable: true })
  cryptoAlgoTrailingBidPoints!: number | null;

  /** Crypto-algo trailing activation in bid points (absolute). Null = inherit interval default. */
  @Column({ type: 'real', name: 'crypto_algo_trailing_activation_bid_points', nullable: true })
  cryptoAlgoTrailingActivationBidPoints!: number | null;

  /** Crypto-algo pre-close toggle. Null = inherit mode default. */
  @Column({ type: 'boolean', name: 'crypto_algo_pre_close_enabled', nullable: true })
  cryptoAlgoPreCloseEnabled!: boolean | null;

  /** Crypto-algo pre-close window (seconds). Null = inherit mode default. */
  @Column({ type: 'integer', name: 'crypto_algo_pre_close_seconds', nullable: true })
  cryptoAlgoPreCloseSeconds!: number | null;

  /** Crypto-algo pre-close keep toggle. Null = inherit mode default. */
  @Column({
    type: 'boolean',
    name: 'crypto_algo_pre_close_keep_enabled',
    nullable: true,
  })
  cryptoAlgoPreCloseKeepEnabled!: boolean | null;

  /** Crypto-algo pre-close keep bid threshold. Null = inherit mode default. */
  @Column({
    type: 'real',
    name: 'crypto_algo_pre_close_keep_bid_threshold',
    nullable: true,
  })
  cryptoAlgoPreCloseKeepBidThreshold!: number | null;

  /**
   * Minimum seconds before market end to allow crypto-algo entry.
   * Null = derive from effective pre-close seconds + buffer.
   */
  @Column({ type: 'integer', name: 'crypto_algo_min_time_to_close', nullable: true })
  cryptoAlgoMinTimeToClose!: number | null;

  /**
   * Override for real cash available. When set, bypasses the on-chain balance fetch
   * and uses this value directly for real-mode sizing. Useful for testing or manual override.
   */
  @Column({ type: 'real', name: 'real_cash_override', nullable: true })
  realCashOverride!: number | null;

  /** Crypto-algo stop-loss toggle. When false, SL is disabled regardless of overrides/defaults. */
  @Column({ type: 'boolean', name: 'crypto_algo_sl_enabled', default: true })
  cryptoAlgoSlEnabled!: boolean;

  /** Crypto-algo take-profit toggle. When false, TP is disabled regardless of overrides/defaults. */
  @Column({ type: 'boolean', name: 'crypto_algo_tp_enabled', default: true })
  cryptoAlgoTpEnabled!: boolean;

  /** Crypto-algo trailing toggle. When false, trailing is disabled regardless of overrides/defaults. */
  @Column({ type: 'boolean', name: 'crypto_algo_trailing_enabled', default: true })
  cryptoAlgoTrailingEnabled!: boolean;

  /** Crypto-algo stop-loss in bid points (absolute) for binary markets. Null = inherit interval default. */
  @Column({ type: 'real', name: 'crypto_algo_sl_bid_points', nullable: true })
  cryptoAlgoSlBidPoints!: number | null | undefined;

  /** Crypto-algo take-profit in bid points (absolute) for binary markets. Null = inherit interval default. */
  @Column({ type: 'real', name: 'crypto_algo_tp_bid_points', nullable: true })
  cryptoAlgoTpBidPoints!: number | null | undefined;

  /**
   * Re-entry throttle window (ms) per conditionId:outcome. Null = market interval
   * duration, then 1h fallback.
   */
  @Column({ type: 'integer', name: 'crypto_algo_reentry_window_ms', nullable: true })
  cryptoAlgoReentryWindowMs!: number | null;

  /**
   * Max successful enqueues per re-entry window per conditionId:outcome.
   * Null = 1.
   */
  @Column({ type: 'integer', name: 'crypto_algo_max_entries_per_window', nullable: true })
  cryptoAlgoMaxEntriesPerWindow!: number | null;

  /**
   * Nombre d'évaluations consécutives où la condition SL doit être vraie
   * avant d'émettre le signal de fermeture. Évite les faux positifs sur
   * micro-pics de liquidité (le prix rebondit entre le trigger et l'exécution
   * réelle sur le CLOB). 1 = pas de confirmation (comportement legacy).
   */
  @Column({ type: 'integer', name: 'sl_confirmation_ticks', default: 2 })
  slConfirmationTicks!: number;

  /** Naive-momentum base threshold. Null → 0.55. */
  @Column({ type: 'real', name: 'crypto_algo_base_threshold', nullable: true })
  cryptoAlgoBaseThreshold!: number | null;

  /** Spread adjustment factor for threshold. Null → 0.5. */
  @Column({
    type: 'real',
    name: 'crypto_algo_spread_adjustment_factor',
    nullable: true,
  })
  cryptoAlgoSpreadAdjustmentFactor!: number | null;

  /** Min absolute spread before threshold adjustment. Null → 0.01. */
  @Column({
    type: 'real',
    name: 'crypto_algo_min_spread_abs_for_adjustment',
    nullable: true,
  })
  cryptoAlgoMinSpreadAbsForAdjustment!: number | null;

  /** Default max spread abs for unknown intervals. Null → 0.02. */
  @Column({ type: 'real', name: 'crypto_algo_max_spread_abs', nullable: true })
  cryptoAlgoMaxSpreadAbs!: number | null;

  /** Gamma outcome price sum tolerance. Null → 0.02. */
  @Column({
    type: 'real',
    name: 'crypto_algo_price_sum_tolerance',
    nullable: true,
  })
  cryptoAlgoPriceSumTolerance!: number | null;

  /** WS/Gamma deviation warn threshold. Null → 0.05. */
  @Column({
    type: 'real',
    name: 'crypto_algo_warn_price_deviation',
    nullable: true,
  })
  cryptoAlgoWarnPriceDeviation!: number | null;

  /** Max WS book age (ms). Null → 15000. */
  @Column({ type: 'integer', name: 'crypto_algo_max_book_age_ms', nullable: true })
  cryptoAlgoMaxBookAgeMs!: number | null;

  /** Gamma cache TTL for short intervals (≤15m). Null → 10000. */
  @Column({
    type: 'integer',
    name: 'crypto_algo_gamma_cache_ttl_short_ms',
    nullable: true,
  })
  cryptoAlgoGammaCacheTtlShortMs!: number | null;

  /** Gamma cache TTL for longer intervals. Null → 30000. */
  @Column({
    type: 'integer',
    name: 'crypto_algo_gamma_cache_ttl_default_ms',
    nullable: true,
  })
  cryptoAlgoGammaCacheTtlDefaultMs!: number | null;

  /** Stale-on-error TTL multiplier for Gamma cache. Null → 2. */
  @Column({
    type: 'real',
    name: 'crypto_algo_gamma_stale_on_error_factor',
    nullable: true,
  })
  cryptoAlgoGammaStaleOnErrorFactor!: number | null;

  /** WS evaluation debounce (ms). Null → 5000. */
  @Column({ type: 'integer', name: 'crypto_algo_ws_debounce_ms', nullable: true })
  cryptoAlgoWsDebounceMs!: number | null;

  /** Strategy runner poll interval (ms). Null → env / 30000. */
  @Column({ type: 'integer', name: 'crypto_algo_poll_ms', nullable: true })
  cryptoAlgoPollMs!: number | null;

  /** Price tick recorder interval (ms). Null → 1000. */
  @Column({ type: 'integer', name: 'crypto_algo_tick_interval_ms', nullable: true })
  cryptoAlgoTickIntervalMs!: number | null;

  /** Price tick retention (hours). Null → 24. */
  @Column({
    type: 'integer',
    name: 'crypto_algo_tick_retention_hours',
    nullable: true,
  })
  cryptoAlgoTickRetentionHours!: number | null;

  /** VWAP reference quantity for price ticks. Null → 50. */
  @Column({ type: 'real', name: 'crypto_algo_price_tick_ref_qty', nullable: true })
  cryptoAlgoPriceTickRefQty!: number | null;

  /** Buffer added to min time-to-close. Null → 30. */
  @Column({
    type: 'integer',
    name: 'crypto_algo_min_time_to_close_buffer_seconds',
    nullable: true,
  })
  cryptoAlgoMinTimeToCloseBufferSeconds!: number | null;

  /** Max age for last closeable bid (ms). Null → 60000. */
  @Column({
    type: 'integer',
    name: 'crypto_algo_last_closeable_bid_max_age_ms',
    nullable: true,
  })
  cryptoAlgoLastCloseableBidMaxAgeMs!: number | null;

  /** Partial JSON override for spread abs by interval. Null/{} → code table. */
  @Column({ type: 'text', name: 'crypto_algo_spread_abs_by_interval', nullable: true })
  cryptoAlgoSpreadAbsByInterval!: string | null;

  /** Partial JSON override for exit defaults by interval. Null/{} → code table. */
  @Column({
    type: 'text',
    name: 'crypto_algo_exit_defaults_by_interval',
    nullable: true,
  })
  cryptoAlgoExitDefaultsByInterval!: string | null;

  /** Partial JSON override for pre-close seconds by interval. Null/{} → code table. */
  @Column({
    type: 'text',
    name: 'crypto_algo_pre_close_seconds_by_interval',
    nullable: true,
  })
  cryptoAlgoPreCloseSecondsByInterval!: string | null;

  /** Sim execution latency mode. Null → fixed. */
  @Column({ type: 'text', name: 'sim_exec_latency_mode', nullable: true })
  simExecLatencyMode!: string | null;

  /** Fixed sim latency (ms) when mode is fixed. Null → env / 150. */
  @Column({ type: 'integer', name: 'sim_exec_latency_ms', nullable: true })
  simExecLatencyMs!: number | null;

  /** Subtract recent sim fills from book depth before matching. Null → false. */
  @Column({ type: 'boolean', name: 'sim_self_impact_enabled', nullable: true })
  simSelfImpactEnabled!: boolean | null;

  /** TTL (seconds) for self-impact consumption. Null → 8. */
  @Column({ type: 'integer', name: 'sim_self_impact_ttl_seconds', nullable: true })
  simSelfImpactTtlSeconds!: number | null;

  /** Read-only wallet balance preflight on sim BUY. Null → false. */
  @Column({ type: 'boolean', name: 'sim_wallet_preflight_enabled', nullable: true })
  simWalletPreflightEnabled!: boolean | null;

  /** Log real vs shadow FAK fills. Null → false. */
  @Column({ type: 'boolean', name: 'sim_shadow_logging_enabled', nullable: true })
  simShadowLoggingEnabled!: boolean | null;

  /** Retention for latency/shadow sample tables (days). Null → 14. */
  @Column({ type: 'integer', name: 'shadow_sample_retention_days', nullable: true })
  shadowSampleRetentionDays!: number | null;

  /**
   * When enabled, tracks SL-triggered exits per market (from beginClose) and blocks
   * new entries once quota is reached. At most one open/closing algo position per market.
   */
  @Column({ type: 'boolean', name: 'crypto_algo_sl_quota_enabled', default: false })
  cryptoAlgoSlQuotaEnabled!: boolean;

  /** Maximum SL slots consumed per market before blocking new entries (cross-outcome). */
  @Column({ type: 'integer', name: 'crypto_algo_sl_quota_per_market', default: 1 })
  cryptoAlgoSlQuotaPerMarket!: number;

  /** TTL (seconds) for the SL quota count cache. Avoids hitting the DB on every evaluation cycle. */
  @Column({ type: 'integer', name: 'crypto_algo_sl_quota_cache_ttl_seconds', default: 30 })
  cryptoAlgoSlQuotaCacheTtlSeconds!: number;

  /** Entry band lower bound (exclusive) on bought-token price. Null → 0.50. */
  @Column({ type: 'real', name: 'crypto_algo_entry_price_min', nullable: true })
  cryptoAlgoEntryPriceMin!: number | null;

  /** Entry band upper bound (exclusive) on bought-token price. Null → 0.80. */
  @Column({ type: 'real', name: 'crypto_algo_entry_price_max', nullable: true })
  cryptoAlgoEntryPriceMax!: number | null;

  /** When true, entry band replaces momentum threshold for direction. Null → true. */
  @Column({
    type: 'boolean',
    name: 'crypto_algo_entry_price_band_enabled',
    nullable: true,
  })
  cryptoAlgoEntryPriceBandEnabled!: boolean | null;

  /** When true, block entry if bought-token mid is descending. Null → false. */
  @Column({
    type: 'boolean',
    name: 'crypto_algo_curve_filter_enabled',
    nullable: true,
  })
  cryptoAlgoCurveFilterEnabled!: boolean | null;

  /** Lookback window (ms) for curve descending gate. Null → 10000. */
  @Column({ type: 'integer', name: 'crypto_algo_curve_lookback_ms', nullable: true })
  cryptoAlgoCurveLookbackMs!: number | null;

  /** Minimum mid drop (probability points) for curve descending gate. Null → 0.01. */
  @Column({ type: 'real', name: 'crypto_algo_curve_min_delta', nullable: true })
  cryptoAlgoCurveMinDelta!: number | null;

  /** Crypto-algo sizing mode (fixed_usdc or fixed_shares). */
  @Column({ type: 'text', name: 'crypto_algo_sizing_mode', default: 'fixed_usdc' })
  cryptoAlgoSizingMode!: string;

  /** Fixed USDC amount per crypto-algo entry. */
  @Column({ type: 'real', name: 'crypto_algo_entry_usdc_amount', default: 10 })
  cryptoAlgoEntryUsdcAmount!: number;

  /** Fixed share count per crypto-algo entry. Nullable for fixed_usdc mode. */
  @Column({ type: 'real', name: 'crypto_algo_entry_share_count', nullable: true })
  cryptoAlgoEntryShareCount!: number | null;

  /** Master toggle for weather-algo execution. */
  @Column({ type: 'boolean', name: 'weather_algo_enabled', default: false })
  weatherAlgoEnabled!: boolean;

  /** Whether weather-algo executes in simulation mode. Default true (preserves legacy behaviour). */
  @Column({ type: 'boolean', name: 'weather_algo_sim_enabled', default: true })
  weatherAlgoSimEnabled!: boolean;

  /** Whether weather-algo executes in real mode. Default false. Requires realTradingEnabled too. */
  @Column({ type: 'boolean', name: 'weather_algo_real_enabled', default: false })
  weatherAlgoRealEnabled!: boolean;

  /** Base edge (forecast prob - market price) required for entry. Default 10%. */
  @Column({ type: 'real', name: 'weather_algo_min_edge', default: 0.10 })
  weatherAlgoMinEdge!: number;

  /** Max forecast std dev (°C) to allow entry. Null = no cap. */
  @Column({ type: 'real', name: 'weather_algo_max_forecast_std', nullable: true })
  weatherAlgoMaxForecastStd!: number | null;

  /** Sizing mode for weather-algo. */
  @Column({ type: 'text', name: 'weather_algo_sizing_mode', default: 'fixed_usdc' })
  weatherAlgoSizingMode!: string;

  /** Fixed USDC amount per weather-algo entry. */
  @Column({ type: 'real', name: 'weather_algo_entry_usdc', default: 10 })
  weatherAlgoEntryUsdc!: number;

  /** Selection mode: 'single' | 'multi' | 'spread'. */
  @Column({ type: 'text', name: 'weather_algo_selection_mode', default: 'single' })
  weatherAlgoSelectionMode!: string;

  /** Max signals per event in 'multi' mode. */
  @Column({ type: 'integer', name: 'weather_algo_max_signals_per_event', default: 3 })
  weatherAlgoMaxSignalsPerEvent!: number;

  /** Forecast mean drift (°C) that triggers position close. */
  @Column({ type: 'real', name: 'weather_algo_forecast_change_threshold', default: 2 })
  weatherAlgoForecastChangeThreshold!: number;

  /** Auto-close positions X hours before market resolution. */
  @Column({ type: 'real', name: 'weather_algo_close_before_resolution_hours', default: 1 })
  weatherAlgoCloseBeforeResolutionHours!: number;

  /** Evaluation polling interval (ms). Default 30min. */
  @Column({ type: 'integer', name: 'weather_algo_poll_ms', default: 1800000 })
  weatherAlgoPollMs!: number;

  /** City-follow switch mode: close_and_reenter | hold. */
  @Column({ type: 'text', name: 'weather_algo_city_follow_switch_mode', default: 'close_and_reenter' })
  weatherAlgoCityFollowSwitchMode!: string;

  @Column({ type: 'integer', name: 'weather_algo_bucket_hysteresis_polls', default: 2 })
  weatherAlgoBucketHysteresisPolls!: number;

  @Column({ type: 'integer', name: 'weather_algo_reentry_throttle_ms', default: 1800000 })
  weatherAlgoReentryThrottleMs!: number;
}
