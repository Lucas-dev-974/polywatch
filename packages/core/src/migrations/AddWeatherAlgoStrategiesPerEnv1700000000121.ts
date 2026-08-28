import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds per-environment weather-algo strategy columns (sim / real) and the
 * `mode` column on the evaluation log.
 *
 * Up:
 *  - 4 new columns on `weather_config`, backfilled from the legacy
 *    `weather_algo_strategies` / `weather_algo_strategy_params` columns.
 *  - `mode` column (text, default 'sim') + index on `weather_evaluation_log`.
 *
 * Down:
 *  - Drops the index and the 5 columns (reverse order).
 *
 * The legacy columns are intentionally NOT dropped: they remain read-only
 * fallbacks for old backtest snapshots and the compatibility GET.
 */
export class AddWeatherAlgoStrategiesPerEnv1700000000121 implements MigrationInterface {
  name = 'AddWeatherAlgoStrategiesPerEnv1700000000121';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "weather_config" ADD COLUMN IF NOT EXISTS "sim_weather_algo_strategies" text DEFAULT '["weather-forecast"]'`,
    );
    await queryRunner.query(
      `ALTER TABLE "weather_config" ADD COLUMN IF NOT EXISTS "real_weather_algo_strategies" text DEFAULT '["weather-forecast"]'`,
    );
    await queryRunner.query(
      `ALTER TABLE "weather_config" ADD COLUMN IF NOT EXISTS "sim_weather_algo_strategy_params" text DEFAULT '{}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "weather_config" ADD COLUMN IF NOT EXISTS "real_weather_algo_strategy_params" text DEFAULT '{}'`,
    );

    // Idempotent backfill: only rows still at factory default / empty, or both
    // env columns still mirrored at default while legacy diverges (first deploy).
    await queryRunner.query(
      `UPDATE "weather_config" SET
        "sim_weather_algo_strategies" = COALESCE("weather_algo_strategies", '["weather-forecast"]')
       WHERE "sim_weather_algo_strategies" IS NULL
          OR TRIM("sim_weather_algo_strategies") = ''
          OR (
            "sim_weather_algo_strategies" = '["weather-forecast"]'
            AND "real_weather_algo_strategies" = '["weather-forecast"]'
            AND COALESCE("weather_algo_strategies", '["weather-forecast"]') <> '["weather-forecast"]'
          )`,
    );
    await queryRunner.query(
      `UPDATE "weather_config" SET
        "real_weather_algo_strategies" = COALESCE("weather_algo_strategies", '["weather-forecast"]')
       WHERE "real_weather_algo_strategies" IS NULL
          OR TRIM("real_weather_algo_strategies") = ''
          OR (
            "real_weather_algo_strategies" = '["weather-forecast"]'
            AND "sim_weather_algo_strategies" = '["weather-forecast"]'
            AND COALESCE("weather_algo_strategies", '["weather-forecast"]') <> '["weather-forecast"]'
          )`,
    );
    await queryRunner.query(
      `UPDATE "weather_config" SET
        "sim_weather_algo_strategy_params" = COALESCE("weather_algo_strategy_params", '{}')
       WHERE "sim_weather_algo_strategy_params" IS NULL
          OR TRIM("sim_weather_algo_strategy_params") = ''
          OR (
            "sim_weather_algo_strategy_params" = '{}'
            AND "real_weather_algo_strategy_params" = '{}'
            AND COALESCE("weather_algo_strategy_params", '{}') <> '{}'
          )`,
    );
    await queryRunner.query(
      `UPDATE "weather_config" SET
        "real_weather_algo_strategy_params" = COALESCE("weather_algo_strategy_params", '{}')
       WHERE "real_weather_algo_strategy_params" IS NULL
          OR TRIM("real_weather_algo_strategy_params") = ''
          OR (
            "real_weather_algo_strategy_params" = '{}'
            AND "sim_weather_algo_strategy_params" = '{}'
            AND COALESCE("weather_algo_strategy_params", '{}') <> '{}'
          )`,
    );

    await queryRunner.query(
      `ALTER TABLE "weather_evaluation_log" ADD COLUMN IF NOT EXISTS "mode" text NOT NULL DEFAULT 'sim'`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_weather_evaluation_log_mode_evaluated_at"
       ON "weather_evaluation_log" ("mode", "evaluated_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_weather_evaluation_log_mode_evaluated_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "weather_evaluation_log" DROP COLUMN IF EXISTS "mode"`,
    );
    await queryRunner.query(
      `ALTER TABLE "weather_config" DROP COLUMN IF EXISTS "real_weather_algo_strategy_params"`,
    );
    await queryRunner.query(
      `ALTER TABLE "weather_config" DROP COLUMN IF EXISTS "sim_weather_algo_strategy_params"`,
    );
    await queryRunner.query(
      `ALTER TABLE "weather_config" DROP COLUMN IF EXISTS "real_weather_algo_strategies"`,
    );
    await queryRunner.query(
      `ALTER TABLE "weather_config" DROP COLUMN IF EXISTS "sim_weather_algo_strategies"`,
    );
  }
}
