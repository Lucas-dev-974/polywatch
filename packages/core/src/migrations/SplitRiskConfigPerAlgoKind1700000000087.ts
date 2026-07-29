import type { MigrationInterface, QueryRunner } from 'typeorm';

export class SplitRiskConfigPerAlgoKind1700000000087 implements MigrationInterface {
  name = 'SplitRiskConfigPerAlgoKind1700000000087';

  async up(queryRunner: QueryRunner): Promise<void> {
    // ── 1. Create global_config ──────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS global_config (
        id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,

        max_slippage_percent REAL NOT NULL DEFAULT 2,
        exit_slippage_guard_percent REAL NOT NULL DEFAULT 50,
        real_trading_enabled BOOLEAN NOT NULL DEFAULT false,
        real_cash_override REAL,

        sim_exec_latency_mode TEXT,
        sim_exec_latency_ms INTEGER,
        sim_self_impact_enabled BOOLEAN,
        sim_self_impact_ttl_seconds INTEGER,
        sim_wallet_preflight_enabled BOOLEAN,
        sim_shadow_logging_enabled BOOLEAN,
        shadow_sample_retention_days INTEGER,

        sim_auto_snapshot_enabled BOOLEAN NOT NULL DEFAULT false,
        sim_auto_snapshot_interval_seconds INTEGER NOT NULL DEFAULT 3600,
        sim_snapshot_max_count INTEGER,
        sim_snapshot_retention_days INTEGER,
        sim_auto_snapshot_empty_session BOOLEAN NOT NULL DEFAULT false,
        sim_snapshot_decision_window_hours INTEGER NOT NULL DEFAULT 24,

        real_auto_snapshot_enabled BOOLEAN NOT NULL DEFAULT false,
        real_auto_snapshot_interval_seconds INTEGER NOT NULL DEFAULT 3600,
        real_snapshot_max_count INTEGER,
        real_snapshot_retention_days INTEGER,
        real_snapshot_decision_window_hours INTEGER NOT NULL DEFAULT 24
      )
    `);

    // ── 2. Create copy_config ────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS copy_config (
        id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,

        sim_max_open_positions INTEGER NOT NULL DEFAULT 10,
        real_max_open_positions INTEGER NOT NULL DEFAULT 10,
        sim_max_exposure_usdc REAL NOT NULL DEFAULT 1000,
        real_max_exposure_usdc REAL NOT NULL DEFAULT 1000,
        sim_max_daily_loss_usdc REAL NOT NULL DEFAULT 100,
        real_max_daily_loss_usdc REAL NOT NULL DEFAULT 100,
        sim_max_position_size_usdc REAL NOT NULL DEFAULT 200,
        real_max_position_size_usdc REAL NOT NULL DEFAULT 200,

        sim_min_bid_to_ask_ratio REAL NOT NULL DEFAULT 0.9,
        real_min_bid_to_ask_ratio REAL NOT NULL DEFAULT 0.9,
        sim_momentum_filter_enabled BOOLEAN NOT NULL DEFAULT false,
        real_momentum_filter_enabled BOOLEAN NOT NULL DEFAULT false,

        sim_copy_trading_enabled BOOLEAN NOT NULL DEFAULT true,
        real_copy_trading_enabled BOOLEAN NOT NULL DEFAULT true,

        sim_sizing_mode TEXT NOT NULL DEFAULT 'fixed_usdc',
        sim_copy_ratio REAL NOT NULL DEFAULT 1.0,
        sim_entry_usdc_amount REAL NOT NULL DEFAULT 10,
        sim_entry_share_count INTEGER NOT NULL DEFAULT 5,
        sim_kelly_fraction REAL NOT NULL DEFAULT 0.25,
        sim_risk_budget_usdc REAL NOT NULL DEFAULT 10,
        sim_default_win_probability REAL NOT NULL DEFAULT 0.55,

        real_sizing_mode TEXT NOT NULL DEFAULT 'fixed_usdc',
        real_copy_ratio REAL NOT NULL DEFAULT 1.0,
        real_entry_usdc_amount REAL NOT NULL DEFAULT 10,
        real_entry_share_count INTEGER NOT NULL DEFAULT 5,
        real_kelly_fraction REAL NOT NULL DEFAULT 0.25,
        real_risk_budget_usdc REAL NOT NULL DEFAULT 10,
        real_default_win_probability REAL NOT NULL DEFAULT 0.55,

        sim_trailing_enabled BOOLEAN NOT NULL DEFAULT true,
        sim_trailing_bid_points REAL NOT NULL DEFAULT 0.05,
        sim_trailing_activation_bid_points REAL NOT NULL DEFAULT 0.06,
        real_trailing_enabled BOOLEAN NOT NULL DEFAULT true,
        real_trailing_bid_points REAL NOT NULL DEFAULT 0.05,
        real_trailing_activation_bid_points REAL NOT NULL DEFAULT 0.06,

        sim_sl_enabled BOOLEAN NOT NULL DEFAULT true,
        sim_tp_enabled BOOLEAN NOT NULL DEFAULT true,
        real_sl_enabled BOOLEAN NOT NULL DEFAULT true,
        real_tp_enabled BOOLEAN NOT NULL DEFAULT true,

        sim_sl_bid_points REAL NOT NULL DEFAULT 0.10,
        sim_tp_bid_points REAL NOT NULL DEFAULT 0.12,
        real_sl_bid_points REAL NOT NULL DEFAULT 0.10,
        real_tp_bid_points REAL NOT NULL DEFAULT 0.12,

        sim_sl_close_max_retries INTEGER NOT NULL DEFAULT 5,
        real_sl_close_max_retries INTEGER NOT NULL DEFAULT 5,

        sim_entry_depth_retry_max INTEGER NOT NULL DEFAULT 3,
        sim_entry_depth_retry_delay_ms INTEGER NOT NULL DEFAULT 1000,
        real_entry_depth_retry_max INTEGER NOT NULL DEFAULT 3,
        real_entry_depth_retry_delay_ms INTEGER NOT NULL DEFAULT 1000,

        sim_kill_switch_action TEXT NOT NULL DEFAULT 'block_entries',
        real_kill_switch_action TEXT NOT NULL DEFAULT 'block_entries',

        sim_copy_increase_enabled BOOLEAN NOT NULL DEFAULT true,
        sim_copy_decrease_enabled BOOLEAN NOT NULL DEFAULT true,
        real_copy_increase_enabled BOOLEAN NOT NULL DEFAULT true,
        real_copy_decrease_enabled BOOLEAN NOT NULL DEFAULT true,

        sim_max_increases_per_position INTEGER NOT NULL DEFAULT 1,
        real_max_increases_per_position INTEGER NOT NULL DEFAULT 0,

        sim_copy_increase_sl_proximity_enabled BOOLEAN NOT NULL DEFAULT true,
        sim_copy_increase_sl_proximity_percent REAL NOT NULL DEFAULT 80,
        real_copy_increase_sl_proximity_enabled BOOLEAN NOT NULL DEFAULT false,
        real_copy_increase_sl_proximity_percent REAL NOT NULL DEFAULT 80,

        sim_pre_close_enabled BOOLEAN NOT NULL DEFAULT true,
        sim_pre_close_seconds INTEGER NOT NULL DEFAULT 60,
        real_pre_close_enabled BOOLEAN NOT NULL DEFAULT true,
        real_pre_close_seconds INTEGER NOT NULL DEFAULT 60,

        sim_min_time_to_close INTEGER NOT NULL DEFAULT 0,
        real_min_time_to_close INTEGER NOT NULL DEFAULT 0,

        sim_pre_close_keep_enabled BOOLEAN NOT NULL DEFAULT false,
        sim_pre_close_keep_bid_threshold REAL NOT NULL DEFAULT 0.80,
        real_pre_close_keep_enabled BOOLEAN NOT NULL DEFAULT false,
        real_pre_close_keep_bid_threshold REAL NOT NULL DEFAULT 0.80,

        sim_allowed_market_tags TEXT NOT NULL DEFAULT '[]',
        real_allowed_market_tags TEXT NOT NULL DEFAULT '[]',

        sim_signal_score_sizing_enabled BOOLEAN NOT NULL DEFAULT true,
        real_signal_score_sizing_enabled BOOLEAN NOT NULL DEFAULT true,

        sim_initial_capital_copy REAL NOT NULL DEFAULT 10000,

        copy_increase_enabled BOOLEAN NOT NULL DEFAULT true,
        copy_decrease_enabled BOOLEAN NOT NULL DEFAULT true,
        max_increases_per_position INTEGER NOT NULL DEFAULT 0,
        pre_close_enabled BOOLEAN NOT NULL DEFAULT true,
        pre_close_seconds INTEGER NOT NULL DEFAULT 60,
        kill_switch_action TEXT NOT NULL DEFAULT 'block_entries',
        sl_confirmation_ticks INTEGER NOT NULL DEFAULT 2,
        move_detector_interval_ms INTEGER NOT NULL DEFAULT 2000
      )
    `);

    // ── 3. Create crypto_config ──────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS crypto_config (
        id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,

        crypto_algo_max_open_positions INTEGER NOT NULL DEFAULT 10,
        crypto_algo_max_exposure_usdc REAL NOT NULL DEFAULT 1000,
        crypto_algo_max_daily_loss_usdc REAL NOT NULL DEFAULT 100,
        crypto_algo_max_position_size_usdc REAL NOT NULL DEFAULT 200,
        crypto_algo_sl_confirmation_ticks INTEGER NOT NULL DEFAULT 2,

        crypto_algo_kill_switch_action TEXT NOT NULL DEFAULT 'block_entries',
        crypto_algo_min_bid_to_ask_ratio REAL NOT NULL DEFAULT 0.9,
        crypto_algo_entry_depth_retry_max INTEGER NOT NULL DEFAULT 3,
        crypto_algo_entry_depth_retry_delay_ms INTEGER NOT NULL DEFAULT 1000,
        crypto_algo_sl_close_max_retries INTEGER NOT NULL DEFAULT 5,
        crypto_algo_allowed_market_tags TEXT NOT NULL DEFAULT '[]',
        crypto_algo_signal_score_sizing_enabled BOOLEAN NOT NULL DEFAULT true,

        crypto_algo_enabled BOOLEAN NOT NULL DEFAULT false,
        crypto_algo_price_tick_cleanup_enabled BOOLEAN NOT NULL DEFAULT true,
        crypto_algo_price_tick_cleanup_interval_minutes INTEGER NOT NULL DEFAULT 60,
        crypto_algo_strategies TEXT NOT NULL DEFAULT '["naive-momentum"]',

        crypto_algo_trailing_bid_points REAL,
        crypto_algo_trailing_activation_bid_points REAL,

        crypto_algo_pre_close_enabled BOOLEAN,
        crypto_algo_pre_close_seconds INTEGER,
        crypto_algo_pre_close_keep_enabled BOOLEAN,
        crypto_algo_pre_close_keep_bid_threshold REAL,
        crypto_algo_min_time_to_close INTEGER,

        crypto_algo_sl_enabled BOOLEAN NOT NULL DEFAULT true,
        crypto_algo_tp_enabled BOOLEAN NOT NULL DEFAULT true,
        crypto_algo_trailing_enabled BOOLEAN NOT NULL DEFAULT true,

        crypto_algo_sl_bid_points REAL,
        crypto_algo_tp_bid_points REAL,

        crypto_algo_reentry_window_ms INTEGER,
        crypto_algo_max_entries_per_window INTEGER,

        crypto_algo_base_threshold REAL,
        crypto_algo_spread_adjustment_factor REAL,
        crypto_algo_min_spread_abs_for_adjustment REAL,
        crypto_algo_max_spread_abs REAL,
        crypto_algo_price_sum_tolerance REAL,
        crypto_algo_warn_price_deviation REAL,

        crypto_algo_max_book_age_ms INTEGER,
        crypto_algo_gamma_cache_ttl_short_ms INTEGER,
        crypto_algo_gamma_cache_ttl_default_ms INTEGER,
        crypto_algo_gamma_stale_on_error_factor REAL,
        crypto_algo_ws_debounce_ms INTEGER,
        crypto_algo_poll_ms INTEGER,

        crypto_algo_tick_interval_ms INTEGER,
        crypto_algo_tick_retention_hours INTEGER,
        crypto_algo_price_tick_ref_qty REAL,

        crypto_algo_min_time_to_close_buffer_seconds INTEGER,
        crypto_algo_last_closeable_bid_max_age_ms INTEGER,

        crypto_algo_spread_abs_by_interval TEXT,
        crypto_algo_exit_defaults_by_interval TEXT,
        crypto_algo_pre_close_seconds_by_interval TEXT,

        crypto_algo_sl_quota_enabled BOOLEAN NOT NULL DEFAULT false,
        crypto_algo_sl_quota_per_market INTEGER NOT NULL DEFAULT 1,
        crypto_algo_sl_quota_cache_ttl_seconds INTEGER NOT NULL DEFAULT 30,

        crypto_algo_entry_price_min REAL,
        crypto_algo_entry_price_max REAL,
        crypto_algo_entry_price_band_enabled BOOLEAN,

        crypto_algo_curve_filter_enabled BOOLEAN,
        crypto_algo_curve_lookback_ms INTEGER,
        crypto_algo_curve_min_delta REAL,

        crypto_algo_sizing_mode TEXT NOT NULL DEFAULT 'fixed_usdc',
        crypto_algo_entry_usdc_amount REAL NOT NULL DEFAULT 10,
        crypto_algo_entry_share_count REAL,

        sim_initial_capital_crypto REAL NOT NULL DEFAULT 10000
      )
    `);

    // ── 4. Create weather_config ────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS weather_config (
        id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,

        weather_algo_max_open_positions INTEGER NOT NULL DEFAULT 10,
        weather_algo_max_exposure_usdc REAL NOT NULL DEFAULT 1000,
        weather_algo_max_daily_loss_usdc REAL NOT NULL DEFAULT 100,
        weather_algo_max_position_size_usdc REAL NOT NULL DEFAULT 200,
        weather_algo_sl_confirmation_ticks INTEGER NOT NULL DEFAULT 2,

        weather_algo_kill_switch_action TEXT NOT NULL DEFAULT 'block_entries',
        weather_algo_min_bid_to_ask_ratio REAL NOT NULL DEFAULT 0.9,
        weather_algo_entry_depth_retry_max INTEGER NOT NULL DEFAULT 3,
        weather_algo_entry_depth_retry_delay_ms INTEGER NOT NULL DEFAULT 1000,
        weather_algo_sl_close_max_retries INTEGER NOT NULL DEFAULT 5,
        weather_algo_min_time_to_close INTEGER NOT NULL DEFAULT 0,
        weather_algo_allowed_market_tags TEXT NOT NULL DEFAULT '[]',
        weather_algo_signal_score_sizing_enabled BOOLEAN NOT NULL DEFAULT true,

        weather_algo_pre_close_enabled BOOLEAN NOT NULL DEFAULT true,
        weather_algo_pre_close_seconds INTEGER NOT NULL DEFAULT 60,

        weather_algo_sl_enabled BOOLEAN NOT NULL DEFAULT true,
        weather_algo_tp_enabled BOOLEAN NOT NULL DEFAULT true,
        weather_algo_trailing_enabled BOOLEAN NOT NULL DEFAULT true,

        weather_algo_sl_bid_points REAL,
        weather_algo_tp_bid_points REAL,
        weather_algo_trailing_bid_points REAL,
        weather_algo_trailing_activation_bid_points REAL,

        weather_algo_enabled BOOLEAN NOT NULL DEFAULT false,
        weather_algo_sim_enabled BOOLEAN NOT NULL DEFAULT true,
        weather_algo_real_enabled BOOLEAN NOT NULL DEFAULT false,

        weather_algo_min_edge REAL NOT NULL DEFAULT 0.10,
        weather_algo_max_forecast_std REAL,

        weather_algo_sizing_mode TEXT NOT NULL DEFAULT 'fixed_usdc',
        weather_algo_entry_usdc REAL NOT NULL DEFAULT 10,

        weather_algo_selection_mode TEXT NOT NULL DEFAULT 'single',
        weather_algo_max_signals_per_event INTEGER NOT NULL DEFAULT 3,

        weather_algo_forecast_change_threshold REAL NOT NULL DEFAULT 2,
        weather_algo_close_before_resolution_hours REAL NOT NULL DEFAULT 1,

        weather_algo_poll_ms INTEGER NOT NULL DEFAULT 1800000,

        weather_algo_city_follow_switch_mode TEXT NOT NULL DEFAULT 'close_and_reenter',

        sim_initial_capital_weather REAL NOT NULL DEFAULT 10000
      )
    `);

    // ── 5. Add config_kind to risk_config_revisions (nullable) ───────
    await queryRunner.query(`
      ALTER TABLE risk_config_revisions
      ADD COLUMN IF NOT EXISTS config_kind TEXT
    `);

    // ── 6. Make config_fingerprint nullable (non-crypto revisions) ───
    await queryRunner.query(`
      ALTER TABLE risk_config_revisions
      ALTER COLUMN config_fingerprint DROP NOT NULL
    `);

    // ── 7. Create index on risk_config_revisions ────────────────────
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_risk_config_revisions_kind_created
      ON risk_config_revisions(config_kind, created_at)
    `);

    // ── 7. Copy data from risk_config (id=1) into the 4 new tables ──
    //     We use a subquery to fetch the single risk_config row.
    //     For the new friction fields that don't exist in risk_config,
    //     we derive them from the sim_* equivalents.

    await queryRunner.query(`
      INSERT INTO global_config (
        max_slippage_percent,
        exit_slippage_guard_percent,
        real_trading_enabled,
        real_cash_override,
        sim_exec_latency_mode,
        sim_exec_latency_ms,
        sim_self_impact_enabled,
        sim_self_impact_ttl_seconds,
        sim_wallet_preflight_enabled,
        sim_shadow_logging_enabled,
        shadow_sample_retention_days,
        sim_auto_snapshot_enabled,
        sim_auto_snapshot_interval_seconds,
        sim_snapshot_max_count,
        sim_snapshot_retention_days,
        sim_auto_snapshot_empty_session,
        sim_snapshot_decision_window_hours,
        real_auto_snapshot_enabled,
        real_auto_snapshot_interval_seconds,
        real_snapshot_max_count,
        real_snapshot_retention_days,
        real_snapshot_decision_window_hours
      )
      SELECT
        max_slippage_percent,
        exit_slippage_guard_percent,
        real_trading_enabled,
        real_cash_override,
        sim_exec_latency_mode,
        sim_exec_latency_ms,
        sim_self_impact_enabled,
        sim_self_impact_ttl_seconds,
        sim_wallet_preflight_enabled,
        sim_shadow_logging_enabled,
        shadow_sample_retention_days,
        sim_auto_snapshot_enabled,
        sim_auto_snapshot_interval_seconds,
        sim_snapshot_max_count,
        sim_snapshot_retention_days,
        sim_auto_snapshot_empty_session,
        sim_snapshot_decision_window_hours,
        real_auto_snapshot_enabled,
        real_auto_snapshot_interval_seconds,
        real_snapshot_max_count,
        real_snapshot_retention_days,
        real_snapshot_decision_window_hours
      FROM risk_config
      WHERE id = 1
    `);

    await queryRunner.query(`
      INSERT INTO copy_config (
        sim_max_open_positions,
        real_max_open_positions,
        sim_max_exposure_usdc,
        real_max_exposure_usdc,
        sim_max_daily_loss_usdc,
        real_max_daily_loss_usdc,
        sim_max_position_size_usdc,
        real_max_position_size_usdc,
        sim_min_bid_to_ask_ratio,
        real_min_bid_to_ask_ratio,
        sim_momentum_filter_enabled,
        real_momentum_filter_enabled,
        sim_copy_trading_enabled,
        real_copy_trading_enabled,
        sim_sizing_mode,
        sim_copy_ratio,
        sim_entry_usdc_amount,
        sim_entry_share_count,
        sim_kelly_fraction,
        sim_risk_budget_usdc,
        sim_default_win_probability,
        real_sizing_mode,
        real_copy_ratio,
        real_entry_usdc_amount,
        real_entry_share_count,
        real_kelly_fraction,
        real_risk_budget_usdc,
        real_default_win_probability,
        sim_trailing_enabled,
        sim_trailing_bid_points,
        sim_trailing_activation_bid_points,
        real_trailing_enabled,
        real_trailing_bid_points,
        real_trailing_activation_bid_points,
        sim_sl_enabled,
        sim_tp_enabled,
        real_sl_enabled,
        real_tp_enabled,
        sim_sl_bid_points,
        sim_tp_bid_points,
        real_sl_bid_points,
        real_tp_bid_points,
        sim_sl_close_max_retries,
        real_sl_close_max_retries,
        sim_entry_depth_retry_max,
        sim_entry_depth_retry_delay_ms,
        real_entry_depth_retry_max,
        real_entry_depth_retry_delay_ms,
        sim_kill_switch_action,
        real_kill_switch_action,
        sim_copy_increase_enabled,
        sim_copy_decrease_enabled,
        real_copy_increase_enabled,
        real_copy_decrease_enabled,
        sim_max_increases_per_position,
        real_max_increases_per_position,
        sim_copy_increase_sl_proximity_enabled,
        sim_copy_increase_sl_proximity_percent,
        real_copy_increase_sl_proximity_enabled,
        real_copy_increase_sl_proximity_percent,
        sim_pre_close_enabled,
        sim_pre_close_seconds,
        real_pre_close_enabled,
        real_pre_close_seconds,
        sim_min_time_to_close,
        real_min_time_to_close,
        sim_pre_close_keep_enabled,
        sim_pre_close_keep_bid_threshold,
        real_pre_close_keep_enabled,
        real_pre_close_keep_bid_threshold,
        sim_allowed_market_tags,
        real_allowed_market_tags,
        sim_signal_score_sizing_enabled,
        real_signal_score_sizing_enabled,
        sim_initial_capital_copy,
        copy_increase_enabled,
        copy_decrease_enabled,
        max_increases_per_position,
        pre_close_enabled,
        pre_close_seconds,
        kill_switch_action,
        sl_confirmation_ticks,
        move_detector_interval_ms
      )
      SELECT
        sim_max_open_positions,
        real_max_open_positions,
        sim_max_exposure_usdc,
        real_max_exposure_usdc,
        sim_max_daily_loss_usdc,
        real_max_daily_loss_usdc,
        sim_max_position_size_usdc,
        real_max_position_size_usdc,
        sim_min_bid_to_ask_ratio,
        real_min_bid_to_ask_ratio,
        sim_momentum_filter_enabled,
        real_momentum_filter_enabled,
        sim_copy_trading_enabled,
        real_copy_trading_enabled,
        sim_sizing_mode,
        sim_copy_ratio,
        sim_entry_usdc_amount,
        sim_entry_share_count,
        sim_kelly_fraction,
        sim_risk_budget_usdc,
        sim_default_win_probability,
        real_sizing_mode,
        real_copy_ratio,
        real_entry_usdc_amount,
        real_entry_share_count,
        real_kelly_fraction,
        real_risk_budget_usdc,
        real_default_win_probability,
        sim_trailing_enabled,
        sim_trailing_bid_points,
        sim_trailing_activation_bid_points,
        real_trailing_enabled,
        real_trailing_bid_points,
        real_trailing_activation_bid_points,
        sim_sl_enabled,
        sim_tp_enabled,
        real_sl_enabled,
        real_tp_enabled,
        sim_sl_bid_points,
        sim_tp_bid_points,
        real_sl_bid_points,
        real_tp_bid_points,
        sim_sl_close_max_retries,
        real_sl_close_max_retries,
        sim_entry_depth_retry_max,
        sim_entry_depth_retry_delay_ms,
        real_entry_depth_retry_max,
        real_entry_depth_retry_delay_ms,
        sim_kill_switch_action,
        real_kill_switch_action,
        sim_copy_increase_enabled,
        sim_copy_decrease_enabled,
        real_copy_increase_enabled,
        real_copy_decrease_enabled,
        sim_max_increases_per_position,
        real_max_increases_per_position,
        sim_copy_increase_sl_proximity_enabled,
        sim_copy_increase_sl_proximity_percent,
        real_copy_increase_sl_proximity_enabled,
        real_copy_increase_sl_proximity_percent,
        sim_pre_close_enabled,
        sim_pre_close_seconds,
        real_pre_close_enabled,
        real_pre_close_seconds,
        sim_min_time_to_close,
        real_min_time_to_close,
        sim_pre_close_keep_enabled,
        sim_pre_close_keep_bid_threshold,
        real_pre_close_keep_enabled,
        real_pre_close_keep_bid_threshold,
        sim_allowed_market_tags,
        real_allowed_market_tags,
        sim_signal_score_sizing_enabled,
        real_signal_score_sizing_enabled,
        COALESCE(sim_initial_capital_copy, 10000),
        copy_increase_enabled,
        copy_decrease_enabled,
        max_increases_per_position,
        pre_close_enabled,
        pre_close_seconds,
        kill_switch_action,
        sl_confirmation_ticks,
        move_detector_interval_ms
      FROM risk_config
      WHERE id = 1
    `);

    await queryRunner.query(`
      INSERT INTO crypto_config (
        crypto_algo_max_open_positions,
        crypto_algo_max_exposure_usdc,
        crypto_algo_max_daily_loss_usdc,
        crypto_algo_max_position_size_usdc,
        crypto_algo_sl_confirmation_ticks,

        crypto_algo_kill_switch_action,
        crypto_algo_min_bid_to_ask_ratio,
        crypto_algo_entry_depth_retry_max,
        crypto_algo_entry_depth_retry_delay_ms,
        crypto_algo_sl_close_max_retries,
        crypto_algo_allowed_market_tags,
        crypto_algo_signal_score_sizing_enabled,

        crypto_algo_enabled,
        crypto_algo_price_tick_cleanup_enabled,
        crypto_algo_price_tick_cleanup_interval_minutes,
        crypto_algo_strategies,
        crypto_algo_trailing_bid_points,
        crypto_algo_trailing_activation_bid_points,
        crypto_algo_pre_close_enabled,
        crypto_algo_pre_close_seconds,
        crypto_algo_pre_close_keep_enabled,
        crypto_algo_pre_close_keep_bid_threshold,
        crypto_algo_min_time_to_close,
        crypto_algo_sl_enabled,
        crypto_algo_tp_enabled,
        crypto_algo_trailing_enabled,
        crypto_algo_sl_bid_points,
        crypto_algo_tp_bid_points,
        crypto_algo_reentry_window_ms,
        crypto_algo_max_entries_per_window,
        crypto_algo_base_threshold,
        crypto_algo_spread_adjustment_factor,
        crypto_algo_min_spread_abs_for_adjustment,
        crypto_algo_max_spread_abs,
        crypto_algo_price_sum_tolerance,
        crypto_algo_warn_price_deviation,
        crypto_algo_max_book_age_ms,
        crypto_algo_gamma_cache_ttl_short_ms,
        crypto_algo_gamma_cache_ttl_default_ms,
        crypto_algo_gamma_stale_on_error_factor,
        crypto_algo_ws_debounce_ms,
        crypto_algo_poll_ms,
        crypto_algo_tick_interval_ms,
        crypto_algo_tick_retention_hours,
        crypto_algo_price_tick_ref_qty,
        crypto_algo_min_time_to_close_buffer_seconds,
        crypto_algo_last_closeable_bid_max_age_ms,
        crypto_algo_spread_abs_by_interval,
        crypto_algo_exit_defaults_by_interval,
        crypto_algo_pre_close_seconds_by_interval,
        crypto_algo_sl_quota_enabled,
        crypto_algo_sl_quota_per_market,
        crypto_algo_sl_quota_cache_ttl_seconds,
        crypto_algo_entry_price_min,
        crypto_algo_entry_price_max,
        crypto_algo_entry_price_band_enabled,
        crypto_algo_curve_filter_enabled,
        crypto_algo_curve_lookback_ms,
        crypto_algo_curve_min_delta,
        crypto_algo_sizing_mode,
        crypto_algo_entry_usdc_amount,
        crypto_algo_entry_share_count,
        sim_initial_capital_crypto
      )
      SELECT
        sim_max_open_positions,
        sim_max_exposure_usdc,
        sim_max_daily_loss_usdc,
        sim_max_position_size_usdc,
        sl_confirmation_ticks,

        COALESCE(sim_kill_switch_action, 'block_entries'),
        COALESCE(sim_min_bid_to_ask_ratio, 0.9),
        COALESCE(sim_entry_depth_retry_max, 3),
        COALESCE(sim_entry_depth_retry_delay_ms, 1000),
        COALESCE(sim_sl_close_max_retries, 5),
        COALESCE(sim_allowed_market_tags, '[]'),
        COALESCE(sim_signal_score_sizing_enabled, true),

        crypto_algo_enabled,
        crypto_algo_price_tick_cleanup_enabled,
        crypto_algo_price_tick_cleanup_interval_minutes,
        crypto_algo_strategies,
        crypto_algo_trailing_bid_points,
        crypto_algo_trailing_activation_bid_points,
        crypto_algo_pre_close_enabled,
        crypto_algo_pre_close_seconds,
        crypto_algo_pre_close_keep_enabled,
        crypto_algo_pre_close_keep_bid_threshold,
        crypto_algo_min_time_to_close,
        crypto_algo_sl_enabled,
        crypto_algo_tp_enabled,
        crypto_algo_trailing_enabled,
        crypto_algo_sl_bid_points,
        crypto_algo_tp_bid_points,
        crypto_algo_reentry_window_ms,
        crypto_algo_max_entries_per_window,
        crypto_algo_base_threshold,
        crypto_algo_spread_adjustment_factor,
        crypto_algo_min_spread_abs_for_adjustment,
        crypto_algo_max_spread_abs,
        crypto_algo_price_sum_tolerance,
        crypto_algo_warn_price_deviation,
        crypto_algo_max_book_age_ms,
        crypto_algo_gamma_cache_ttl_short_ms,
        crypto_algo_gamma_cache_ttl_default_ms,
        crypto_algo_gamma_stale_on_error_factor,
        crypto_algo_ws_debounce_ms,
        crypto_algo_poll_ms,
        crypto_algo_tick_interval_ms,
        crypto_algo_tick_retention_hours,
        crypto_algo_price_tick_ref_qty,
        crypto_algo_min_time_to_close_buffer_seconds,
        crypto_algo_last_closeable_bid_max_age_ms,
        crypto_algo_spread_abs_by_interval,
        crypto_algo_exit_defaults_by_interval,
        crypto_algo_pre_close_seconds_by_interval,
        crypto_algo_sl_quota_enabled,
        crypto_algo_sl_quota_per_market,
        crypto_algo_sl_quota_cache_ttl_seconds,
        crypto_algo_entry_price_min,
        crypto_algo_entry_price_max,
        crypto_algo_entry_price_band_enabled,
        crypto_algo_curve_filter_enabled,
        crypto_algo_curve_lookback_ms,
        crypto_algo_curve_min_delta,
        crypto_algo_sizing_mode,
        crypto_algo_entry_usdc_amount,
        crypto_algo_entry_share_count,
        COALESCE(sim_initial_capital_crypto, 10000)
      FROM risk_config
      WHERE id = 1
    `);

    await queryRunner.query(`
      INSERT INTO weather_config (
        weather_algo_max_open_positions,
        weather_algo_max_exposure_usdc,
        weather_algo_max_daily_loss_usdc,
        weather_algo_max_position_size_usdc,
        weather_algo_sl_confirmation_ticks,

        weather_algo_kill_switch_action,
        weather_algo_min_bid_to_ask_ratio,
        weather_algo_entry_depth_retry_max,
        weather_algo_entry_depth_retry_delay_ms,
        weather_algo_sl_close_max_retries,
        weather_algo_min_time_to_close,
        weather_algo_allowed_market_tags,
        weather_algo_signal_score_sizing_enabled,

        weather_algo_pre_close_enabled,
        weather_algo_pre_close_seconds,

        weather_algo_sl_enabled,
        weather_algo_tp_enabled,
        weather_algo_trailing_enabled,
        weather_algo_sl_bid_points,
        weather_algo_tp_bid_points,
        weather_algo_trailing_bid_points,
        weather_algo_trailing_activation_bid_points,

        weather_algo_enabled,
        weather_algo_sim_enabled,
        weather_algo_real_enabled,
        weather_algo_min_edge,
        weather_algo_max_forecast_std,
        weather_algo_sizing_mode,
        weather_algo_entry_usdc,
        weather_algo_selection_mode,
        weather_algo_max_signals_per_event,
        weather_algo_forecast_change_threshold,
        weather_algo_close_before_resolution_hours,
        weather_algo_poll_ms,
        weather_algo_city_follow_switch_mode,
        sim_initial_capital_weather
      )
      SELECT
        sim_max_open_positions,
        sim_max_exposure_usdc,
        sim_max_daily_loss_usdc,
        sim_max_position_size_usdc,
        sl_confirmation_ticks,

        COALESCE(sim_kill_switch_action, 'block_entries'),
        COALESCE(sim_min_bid_to_ask_ratio, 0.9),
        COALESCE(sim_entry_depth_retry_max, 3),
        COALESCE(sim_entry_depth_retry_delay_ms, 1000),
        COALESCE(sim_sl_close_max_retries, 5),
        COALESCE(sim_min_time_to_close, 0),
        COALESCE(sim_allowed_market_tags, '[]'),
        COALESCE(sim_signal_score_sizing_enabled, true),

        COALESCE(sim_pre_close_enabled, true),
        COALESCE(sim_pre_close_seconds, 60),

        COALESCE(sim_sl_enabled, true),
        COALESCE(sim_tp_enabled, true),
        COALESCE(sim_trailing_enabled, true),
        sim_sl_bid_points,
        sim_tp_bid_points,
        sim_trailing_bid_points,
        sim_trailing_activation_bid_points,

        weather_algo_enabled,
        weather_algo_sim_enabled,
        weather_algo_real_enabled,
        weather_algo_min_edge,
        weather_algo_max_forecast_std,
        weather_algo_sizing_mode,
        weather_algo_entry_usdc,
        weather_algo_selection_mode,
        weather_algo_max_signals_per_event,
        weather_algo_forecast_change_threshold,
        weather_algo_close_before_resolution_hours,
        weather_algo_poll_ms,
        weather_algo_city_follow_switch_mode,
        COALESCE(sim_initial_capital_weather, 10000)
      FROM risk_config
      WHERE id = 1
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS global_config`);
    await queryRunner.query(`DROP TABLE IF EXISTS copy_config`);
    await queryRunner.query(`DROP TABLE IF EXISTS crypto_config`);
    await queryRunner.query(`DROP TABLE IF EXISTS weather_config`);

    await queryRunner.query(`DROP INDEX IF EXISTS idx_risk_config_revisions_kind_created`);

    await queryRunner.query(
      `ALTER TABLE risk_config_revisions DROP COLUMN IF EXISTS config_kind`,
    );
  }
}
