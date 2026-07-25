import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateMarketPositionTicks1700000000014 implements MigrationInterface {
  name = 'CreateMarketPositionTicks1700000000014';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "market_position_ticks" (
        "id" SERIAL PRIMARY KEY NOT NULL,
        "copied_position_id" integer NOT NULL,
        "condition_id" text NOT NULL,
        "asset_id" text NOT NULL,
        "outcome" text NOT NULL,
        "best_bid" real NOT NULL,
        "best_ask" real NOT NULL,
        "mid_price" real NOT NULL,
        "spread" real NOT NULL,
        "spread_percent" real NOT NULL,
        "executable_bid_vwap" real,
        "executable_ask_vwap" real,
        "last_trade_price" real,
        "created_at" timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_market_position_ticks_position"
      ON "market_position_ticks" ("copied_position_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_market_position_ticks_condition_created"
      ON "market_position_ticks" ("condition_id", "created_at")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_market_position_ticks_asset_created"
      ON "market_position_ticks" ("asset_id", "created_at")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "market_position_ticks"`);
  }
}