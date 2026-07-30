import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * City-first weather selection:
 * - Convert expand auto-track rules → city_follow; default mode city_follow
 * - Disable orphan market selections (expand path retired)
 * - Add hysteresis + re-entry throttle columns on weather_config
 * - Normalize switch mode: add_position → close_and_reenter
 */
export class WeatherCityFirstSelection1700000000089 implements MigrationInterface {
  name = 'WeatherCityFirstSelection1700000000089';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "weather_auto_track_rules"
      SET "mode" = 'city_follow'
      WHERE "mode" IS NULL OR "mode" = 'expand'
    `);

    await queryRunner.query(`
      ALTER TABLE "weather_auto_track_rules"
        ALTER COLUMN "mode" SET DEFAULT 'city_follow'
    `);

    await queryRunner.query(`
      UPDATE "weather_auto_track_rules"
      SET "metric" = 'highest_temp'
      WHERE "metric" IS NULL OR "metric" = ''
    `);

    await queryRunner.query(`
      UPDATE "weather_market_selections"
      SET "enabled" = false
      WHERE "enabled" = true
    `);

    await queryRunner.query(`
      ALTER TABLE "weather_config"
        ADD COLUMN IF NOT EXISTS "weather_algo_bucket_hysteresis_polls" integer NOT NULL DEFAULT 2
    `);

    await queryRunner.query(`
      ALTER TABLE "weather_config"
        ADD COLUMN IF NOT EXISTS "weather_algo_reentry_throttle_ms" integer NOT NULL DEFAULT 1800000
    `);

    await queryRunner.query(`
      UPDATE "weather_config"
      SET "weather_algo_city_follow_switch_mode" = 'close_and_reenter'
      WHERE "weather_algo_city_follow_switch_mode" = 'add_position'
         OR "weather_algo_city_follow_switch_mode" IS NULL
         OR "weather_algo_city_follow_switch_mode" = ''
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "weather_config"
        DROP COLUMN IF EXISTS "weather_algo_reentry_throttle_ms"
    `);
    await queryRunner.query(`
      ALTER TABLE "weather_config"
        DROP COLUMN IF EXISTS "weather_algo_bucket_hysteresis_polls"
    `);
    await queryRunner.query(`
      ALTER TABLE "weather_auto_track_rules"
        ALTER COLUMN "mode" SET DEFAULT 'expand'
    `);
  }
}
