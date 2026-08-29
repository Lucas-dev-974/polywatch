import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 6 — Backfill `weather_algo_strategy_params` from the legacy global
 * weather_config columns so a deployment does not lose runtime tuning.
 *
 * For each weather_config row, copy the global tunables into the params bag of
 * every enabled strategy (parse `weather_algo_strategies`). Absent/null values
 * are dropped so the catalogue defaults apply. Pre-existing per-strategy
 * overrides take precedence over the global columns.
 */
export class BackfillWeatherStrategyParams1700000000107 implements MigrationInterface {
  name = 'BackfillWeatherStrategyParams1700000000107';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // All columns that map 1:1 to a bag key. The SQL side builds a JSON
    // object per enabled strategy and merges it into the existing params map.
    await queryRunner.query(`
      UPDATE weather_config
      SET weather_algo_strategy_params = (
        SELECT COALESCE(
          (
            SELECT jsonb_object_agg(
              enabled.strategy_id,
              jsonb_build_object(
                'minEdge', weather_algo_min_edge,
                'maxForecastStd', weather_algo_max_forecast_std,
                'minForecastProbability', weather_algo_min_forecast_probability,
                'entryPusd', weather_algo_entry_usdc,
                'sizingMode', CASE WHEN weather_algo_sizing_mode = 'fixed_usdc' THEN 'fixed_pusd' ELSE weather_algo_sizing_mode END,
                'forecastChangeThreshold', weather_algo_forecast_change_threshold,
                'closeBeforeResolutionHours', weather_algo_close_before_resolution_hours,
                'bucketHysteresisPolls', weather_algo_bucket_hysteresis_polls,
                'reentryThrottleMs', weather_algo_reentry_throttle_ms,
                'cityFollowSwitchMode', weather_algo_city_follow_switch_mode,
                'slEnabled', weather_algo_sl_enabled,
                'tpEnabled', weather_algo_tp_enabled,
                'trailingEnabled', weather_algo_trailing_enabled,
                'slBidPoints', weather_algo_sl_bid_points,
                'tpBidPoints', weather_algo_tp_bid_points,
                'trailingBidPoints', weather_algo_trailing_bid_points,
                'trailingActivationBidPoints', weather_algo_trailing_activation_bid_points,
                'maxOpenPositions', weather_algo_max_open_positions,
                'maxExposurePusd', weather_algo_max_exposure_usdc,
                'maxDailyLossPusd', weather_algo_max_daily_loss_usdc,
                'maxPositionSizePusd', weather_algo_max_position_size_usdc,
                'entryDepthRetryMax', weather_algo_entry_depth_retry_max,
                'entryDepthRetryDelayMs', weather_algo_entry_depth_retry_delay_ms,
                'slCloseMaxRetries', weather_algo_sl_close_max_retries,
                'slConfirmationTicks', weather_algo_sl_confirmation_ticks,
                'killSwitchAction', weather_algo_kill_switch_action,
                'preCloseEnabled', weather_algo_pre_close_enabled,
                'preCloseSeconds', weather_algo_pre_close_seconds,
                'allowedMarketTags', COALESCE(weather_algo_allowed_market_tags, '[]')::jsonb,
                'signalScoreSizingEnabled', weather_algo_signal_score_sizing_enabled,
                'minBidToAskRatio', weather_algo_min_bid_to_ask_ratio,
                'minTimeToClose', weather_algo_min_time_to_close
              ) || COALESCE(existing_map.value, '{}'::jsonb)
            )
            FROM (
              SELECT jsonb_array_elements_text(
                COALESCE(NULLIF(weather_algo_strategies, ''), '["weather-forecast"]')::jsonb
              ) AS strategy_id
            ) AS enabled
            LEFT JOIN (
              SELECT key AS strategy_id, value
              FROM jsonb_each_text(
                COALESCE(NULLIF(weather_algo_strategy_params, ''), '{}')::jsonb
              )
            ) AS existing_map ON existing_map.strategy_id = enabled.strategy_id
          ),
          '{}'::jsonb
        )::text
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Non-reversible: dropping the backfilled params would lose config.
    // No-op to keep the migration chain reversible-safe.
  }
}
