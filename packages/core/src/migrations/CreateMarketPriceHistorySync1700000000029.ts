import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateMarketPriceHistorySync1700000000029 implements MigrationInterface {
  name = 'CreateMarketPriceHistorySync1700000000029';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE market_price_history_sync (
        id SERIAL PRIMARY KEY,
        condition_id TEXT NOT NULL,
        asset_id TEXT NOT NULL,
        end_date TIMESTAMP NULL,
        last_synced_at TIMESTAMP NULL,
        last_point_ts BIGINT NULL,
        sync_status TEXT NOT NULL DEFAULT 'idle',
        next_sync_at TIMESTAMP NULL,
        error_message TEXT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX idx_sync_condition_asset
        ON market_price_history_sync (condition_id, asset_id);
    `);
    await queryRunner.query(`
      CREATE INDEX idx_sync_next
        ON market_price_history_sync (next_sync_at)
        WHERE sync_status IN ('idle', 'error');
    `);
    await queryRunner.query(`
      CREATE INDEX idx_sync_end_date
        ON market_price_history_sync (end_date)
        WHERE sync_status != 'terminal';
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS market_price_history_sync;`);
  }
}
