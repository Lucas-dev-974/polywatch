import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Ensure at most one forecast snapshot per copied position.
 */
export class WeatherPositionForecastUnique1700000000081 implements MigrationInterface {
  name = 'WeatherPositionForecastUnique1700000000081';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "weather_position_forecasts" a
      USING "weather_position_forecasts" b
      WHERE a.id > b.id
        AND a.copied_position_id = b.copied_position_id
    `);

    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_weather_pos_forecast_position_id"`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_weather_pos_forecast_position_id" ON "weather_position_forecasts" ("copied_position_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_weather_pos_forecast_position_id"`);
    await queryRunner.query(
      `CREATE INDEX "IDX_weather_pos_forecast_position_id" ON "weather_position_forecasts" ("copied_position_id")`,
    );
  }
}
