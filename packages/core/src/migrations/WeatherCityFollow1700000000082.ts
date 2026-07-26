import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Add city-follow columns:
 * - weather_auto_track_rules.mode (expand | city_follow)
 * - risk_config.weather_algo_city_follow_switch_mode
 * - weather_position_forecasts.entry_bucket_comparison + entry_bucket_bounds
 */
export class WeatherCityFollow1700000000082 implements MigrationInterface {
  name = 'WeatherCityFollow1700000000082';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "weather_auto_track_rules"
        ADD COLUMN "mode" text DEFAULT 'expand'
    `);

    await queryRunner.query(`
      ALTER TABLE "risk_config"
        ADD COLUMN "weather_algo_city_follow_switch_mode" text DEFAULT 'close_and_reenter'
    `);

    await queryRunner.query(`
      ALTER TABLE "weather_position_forecasts"
        ADD COLUMN "entry_bucket_comparison" text
    `);

    await queryRunner.query(`
      ALTER TABLE "weather_position_forecasts"
        ADD COLUMN "entry_bucket_bounds" text
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "weather_position_forecasts" DROP COLUMN "entry_bucket_bounds"
    `);
    await queryRunner.query(`
      ALTER TABLE "weather_position_forecasts" DROP COLUMN "entry_bucket_comparison"
    `);
    await queryRunner.query(`
      ALTER TABLE "risk_config" DROP COLUMN "weather_algo_city_follow_switch_mode"
    `);
    await queryRunner.query(`
      ALTER TABLE "weather_auto_track_rules" DROP COLUMN "mode"
    `);
  }
}
