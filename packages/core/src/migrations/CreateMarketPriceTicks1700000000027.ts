import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateMarketPriceTicks1700000000027 implements MigrationInterface {
  name = 'CreateMarketPriceTicks1700000000027';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE market_price_ticks (
        id SERIAL PRIMARY KEY,
        condition_id TEXT NOT NULL,
        asset_id TEXT,
        best_bid REAL,
        best_ask REAL,
        mid_price REAL,
        spread REAL,
        spread_percent REAL,
        executable_bid_vwap REAL,
        executable_ask_vwap REAL,
        last_trade_price REAL,
        recorded_at TIMESTAMP NOT NULL DEFAULT NOW(),
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);
    await queryRunner.query(`
      CREATE INDEX idx_market_price_ticks_condition_recorded
        ON market_price_ticks (condition_id, recorded_at);
    `);
    await queryRunner.query(`
      CREATE INDEX idx_market_price_ticks_recorded
        ON market_price_ticks (recorded_at);
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS market_price_ticks;`);
  }
}
