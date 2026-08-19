import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUnitToWeatherBucketTick1700000000114
  implements MigrationInterface
{
  name = 'AddUnitToWeatherBucketTick1700000000114';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE weather_bucket_ticks ADD COLUMN IF NOT EXISTS unit TEXT`,
    );
    // Backfill les lignes existantes à partir de la question (unité d'origine °C/°F).
    await queryRunner.query(`
      UPDATE weather_bucket_ticks
      SET unit = CASE
        WHEN question ILIKE '%°F%' THEN 'fahrenheit'
        WHEN question ILIKE '%°C%' THEN 'celsius'
        ELSE NULL
      END
      WHERE unit IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE weather_bucket_ticks DROP COLUMN IF EXISTS unit`,
    );
  }
}
