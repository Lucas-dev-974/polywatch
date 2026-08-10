import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBucketTickDenormalizedColumns1700000000105 implements MigrationInterface {
  name = 'AddBucketTickDenormalizedColumns1700000000105';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE weather_bucket_ticks ADD COLUMN IF NOT EXISTS city TEXT`,
    );
    await queryRunner.query(
      `ALTER TABLE weather_bucket_ticks ADD COLUMN IF NOT EXISTS city_normalized TEXT`,
    );
    await queryRunner.query(
      `ALTER TABLE weather_bucket_ticks ADD COLUMN IF NOT EXISTS target_date_iso TEXT`,
    );
    await queryRunner.query(
      `ALTER TABLE weather_bucket_ticks ADD COLUMN IF NOT EXISTS metric TEXT`,
    );
    await queryRunner.query(
      `ALTER TABLE weather_bucket_ticks ADD COLUMN IF NOT EXISTS fidelity_minutes INTEGER`,
    );

    // Backfill les lignes existantes depuis le snapshot parent.
    await queryRunner.query(`
      UPDATE weather_bucket_ticks AS t
      SET
        city = s.city,
        city_normalized = s.city_normalized,
        target_date_iso = s.target_date_iso,
        metric = s.metric
      FROM weather_market_snapshots AS s
      WHERE t.snapshot_id = s.id
        AND (t.city IS NULL OR t.city_normalized IS NULL OR t.target_date_iso IS NULL OR t.metric IS NULL)
    `);

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_wbt_city_date_recorded ON weather_bucket_ticks (city_normalized, target_date_iso, recorded_at)`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_wbt_city_date_recorded`);
    await queryRunner.query(
      `ALTER TABLE weather_bucket_ticks DROP COLUMN IF EXISTS fidelity_minutes`,
    );
    await queryRunner.query(
      `ALTER TABLE weather_bucket_ticks DROP COLUMN IF EXISTS metric`,
    );
    await queryRunner.query(
      `ALTER TABLE weather_bucket_ticks DROP COLUMN IF EXISTS target_date_iso`,
    );
    await queryRunner.query(
      `ALTER TABLE weather_bucket_ticks DROP COLUMN IF EXISTS city_normalized`,
    );
    await queryRunner.query(
      `ALTER TABLE weather_bucket_ticks DROP COLUMN IF EXISTS city`,
    );
  }
}