import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWeatherAlgoMinForecastProbability1700000000092
  implements MigrationInterface
{
  name = 'AddWeatherAlgoMinForecastProbability1700000000092';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "weather_config" ADD COLUMN "weather_algo_min_forecast_probability" real NULL`,
    );
    // Default existing rows to 0.30 so legacy long-shot entries are filtered
    // out going forward (the audit showed 0% win rate on low-prob buckets).
    await queryRunner.query(
      `UPDATE "weather_config" SET "weather_algo_min_forecast_probability" = 0.30 WHERE "weather_algo_min_forecast_probability" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "weather_config" DROP COLUMN IF EXISTS "weather_algo_min_forecast_probability"`,
    );
  }
}