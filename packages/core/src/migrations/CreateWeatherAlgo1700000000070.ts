import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateWeatherAlgo1700000000070 implements MigrationInterface {
  name = 'CreateWeatherAlgo1700000000070';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "weather_market_selections" (
        "id" SERIAL PRIMARY KEY,
        "condition_id" TEXT NOT NULL,
        "question" TEXT,
        "event_slug" TEXT,
        "city" TEXT,
        "target_date" TIMESTAMP,
        "metric" TEXT,
        "target_value" REAL,
        "enabled" BOOLEAN DEFAULT true,
        "created_at" TIMESTAMP DEFAULT NOW(),
        "updated_at" TIMESTAMP DEFAULT NOW()
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_weather_sel_condition_id" ON "weather_market_selections" ("condition_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_weather_sel_event_slug" ON "weather_market_selections" ("event_slug")`);
    await queryRunner.query(`CREATE INDEX "IDX_weather_sel_enabled" ON "weather_market_selections" ("enabled")`);

    await queryRunner.query(`
      CREATE TABLE "weather_auto_track_rules" (
        "id" SERIAL PRIMARY KEY,
        "city" TEXT NOT NULL,
        "metric" TEXT NOT NULL,
        "look_ahead_days" INTEGER DEFAULT 1,
        "enabled" BOOLEAN DEFAULT true,
        "created_at" TIMESTAMP DEFAULT NOW(),
        "updated_at" TIMESTAMP DEFAULT NOW()
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_weather_autotrack_enabled" ON "weather_auto_track_rules" ("enabled")`);

    await queryRunner.query(`
      CREATE TABLE "weather_forecast_cache" (
        "id" SERIAL PRIMARY KEY,
        "city" TEXT NOT NULL,
        "forecast_date" TIMESTAMP NOT NULL,
        "metric" TEXT NOT NULL,
        "forecast_mean" REAL NOT NULL,
        "forecast_std_dev" REAL NOT NULL,
        "model_values" TEXT NOT NULL,
        "latitude" REAL NOT NULL,
        "longitude" REAL NOT NULL,
        "fetched_at" TIMESTAMP DEFAULT NOW(),
        "expires_at" TIMESTAMP NOT NULL
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_weather_cache_city_date_metric" ON "weather_forecast_cache" ("city", "forecast_date", "metric")`);

    await queryRunner.query(`
      CREATE TABLE "weather_position_forecasts" (
        "id" SERIAL PRIMARY KEY,
        "copied_position_id" INTEGER NOT NULL,
        "city" TEXT NOT NULL,
        "target_date" TIMESTAMP NOT NULL,
        "metric" TEXT NOT NULL,
        "entry_forecast_mean" REAL NOT NULL,
        "entry_forecast_std_dev" REAL NOT NULL,
        "entry_model_values" TEXT NOT NULL
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_weather_pos_forecast_position_id" ON "weather_position_forecasts" ("copied_position_id")`);

    await queryRunner.query(`ALTER TABLE "risk_config" ADD COLUMN "weather_algo_enabled" BOOLEAN DEFAULT false`);
    await queryRunner.query(`ALTER TABLE "risk_config" ADD COLUMN "weather_algo_min_edge" REAL DEFAULT 0.10`);
    await queryRunner.query(`ALTER TABLE "risk_config" ADD COLUMN "weather_algo_max_forecast_std" REAL`);
    await queryRunner.query(`ALTER TABLE "risk_config" ADD COLUMN "weather_algo_sizing_mode" TEXT DEFAULT 'fixed_usdc'`);
    await queryRunner.query(`ALTER TABLE "risk_config" ADD COLUMN "weather_algo_entry_usdc" REAL DEFAULT 10`);
    await queryRunner.query(`ALTER TABLE "risk_config" ADD COLUMN "weather_algo_selection_mode" TEXT DEFAULT 'single'`);
    await queryRunner.query(`ALTER TABLE "risk_config" ADD COLUMN "weather_algo_max_signals_per_event" INTEGER DEFAULT 3`);
    await queryRunner.query(`ALTER TABLE "risk_config" ADD COLUMN "weather_algo_forecast_change_threshold" REAL DEFAULT 2`);
    await queryRunner.query(`ALTER TABLE "risk_config" ADD COLUMN "weather_algo_close_before_resolution_hours" REAL DEFAULT 1`);
    await queryRunner.query(`ALTER TABLE "risk_config" ADD COLUMN "weather_algo_poll_ms" INTEGER DEFAULT 1800000`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "risk_config" DROP COLUMN IF EXISTS "weather_algo_poll_ms"`);
    await queryRunner.query(`ALTER TABLE "risk_config" DROP COLUMN IF EXISTS "weather_algo_close_before_resolution_hours"`);
    await queryRunner.query(`ALTER TABLE "risk_config" DROP COLUMN IF EXISTS "weather_algo_forecast_change_threshold"`);
    await queryRunner.query(`ALTER TABLE "risk_config" DROP COLUMN IF EXISTS "weather_algo_max_signals_per_event"`);
    await queryRunner.query(`ALTER TABLE "risk_config" DROP COLUMN IF EXISTS "weather_algo_selection_mode"`);
    await queryRunner.query(`ALTER TABLE "risk_config" DROP COLUMN IF EXISTS "weather_algo_entry_usdc"`);
    await queryRunner.query(`ALTER TABLE "risk_config" DROP COLUMN IF EXISTS "weather_algo_sizing_mode"`);
    await queryRunner.query(`ALTER TABLE "risk_config" DROP COLUMN IF EXISTS "weather_algo_max_forecast_std"`);
    await queryRunner.query(`ALTER TABLE "risk_config" DROP COLUMN IF EXISTS "weather_algo_min_edge"`);
    await queryRunner.query(`ALTER TABLE "risk_config" DROP COLUMN IF EXISTS "weather_algo_enabled"`);

    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_weather_cache_city_date_metric"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "weather_forecast_cache"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_weather_pos_forecast_position_id"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "weather_position_forecasts"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_weather_autotrack_enabled"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "weather_auto_track_rules"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_weather_sel_enabled"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_weather_sel_event_slug"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_weather_sel_condition_id"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "weather_market_selections"`);
  }
}