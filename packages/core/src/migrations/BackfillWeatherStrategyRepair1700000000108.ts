import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 6 repair — fix the `0107` backfill for deployments that already ran it.
 *
 * `0107` used `COALESCE(existing_map.value, globals)` which replaced the whole
 * per-strategy bag when a partial bag already existed, silently dropping the
 * global fallback for the missing keys. This migration re-applies a key-by-key
 * merge (`globals || existing`, existing wins per key) so every enabled
 * strategy ends up with a complete bag. It is idempotent: re-merging an already
 * complete bag is a no-op.
 *
 * It also backfills `strategy_id` on legacy weather positions and forecast
 * snapshots that predate the per-strategy model.
 */
export class BackfillWeatherStrategyRepair1700000000108 implements MigrationInterface {
  name = 'BackfillWeatherStrategyRepair1700000000108';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Key-by-key merge of global columns into each enabled strategy's bag.
    //    `globals || existing` => existing keys win, globals fill the rest.
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
              FROM jsonb_each(
                COALESCE(NULLIF(weather_algo_strategy_params, ''), '{}')::jsonb
              )
            ) AS existing_map ON existing_map.strategy_id = enabled.strategy_id
          ),
          '{}'::jsonb
        )::text
      )
    `);

    // 2. Backfill strategy_id on legacy weather positions.
    await queryRunner.query(`
      UPDATE copied_positions
      SET strategy_id = 'weather-forecast'
      WHERE strategy_id IS NULL
        AND reason LIKE 'WEATHER_%'
    `);

    // 3. Backfill strategy_id on forecast snapshots: prefer the linked
    //    position's strategy, fall back to the default weather strategy.
    await queryRunner.query(`
      UPDATE weather_position_forecasts wpf
      SET strategy_id = COALESCE(
        (SELECT cp.strategy_id FROM copied_positions cp WHERE cp.id = wpf.copied_position_id),
        'weather-forecast'
      )
      WHERE wpf.strategy_id IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Non-reversible: dropping the repaired params or strategy_id would lose
    // config / lineage. No-op to keep the migration chain reversible-safe.
  }
}
