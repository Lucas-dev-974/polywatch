import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Makes weather_market_selections.condition_id and
 * weather_forecast_cache.(city, forecast_date, metric) UNIQUE to prevent
 * duplicate rows from concurrent inserts.
 *
 * GHOST-1 fix: the original migration created non-unique indexes, allowing
 * duplicate rows when concurrent calls bypassed the findOne+save pattern.
 */
export class WeatherAlgoUniqueIndexes1700000000080 implements MigrationInterface {
  name = 'WeatherAlgoUniqueIndexes1700000000080';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // --- Deduplicate weather_market_selections before adding UNIQUE index ---
    // Keep the row with the smallest id (oldest), delete the rest.
    await queryRunner.query(`
      DELETE FROM "weather_market_selections" a
      USING "weather_market_selections" b
      WHERE a.id > b.id
        AND a.condition_id = b.condition_id
    `);

    // --- Deduplicate weather_forecast_cache before adding UNIQUE index ---
    // Keep the row with the largest id (most recent fetched_at), delete older duplicates.
    await queryRunner.query(`
      DELETE FROM "weather_forecast_cache" a
      USING "weather_forecast_cache" b
      WHERE a.id < b.id
        AND a.city = b.city
        AND a.forecast_date = b.forecast_date
        AND a.metric = b.metric
    `);

    // Drop the old non-unique indexes and recreate as UNIQUE.
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_weather_sel_condition_id"`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_weather_sel_condition_id" ON "weather_market_selections" ("condition_id")`,
    );

    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_weather_cache_city_date_metric"`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_weather_cache_city_date_metric" ON "weather_forecast_cache" ("city", "forecast_date", "metric")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Revert to non-unique indexes
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_weather_sel_condition_id"`);
    await queryRunner.query(
      `CREATE INDEX "IDX_weather_sel_condition_id" ON "weather_market_selections" ("condition_id")`,
    );

    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_weather_cache_city_date_metric"`);
    await queryRunner.query(
      `CREATE INDEX "IDX_weather_cache_city_date_metric" ON "weather_forecast_cache" ("city", "forecast_date", "metric")`,
    );
  }
}