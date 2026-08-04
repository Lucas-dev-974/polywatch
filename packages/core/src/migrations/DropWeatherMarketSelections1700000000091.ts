import { MigrationInterface, QueryRunner } from 'typeorm';

export class DropWeatherMarketSelections1700000000091 implements MigrationInterface {
  name = 'DropWeatherMarketSelections1700000000091';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_weather_sel_enabled"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_weather_sel_event_slug"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_weather_sel_condition_id"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "weather_market_selections"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
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
  }
}
