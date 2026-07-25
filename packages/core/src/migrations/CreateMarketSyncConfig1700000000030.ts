import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateMarketSyncConfig1700000000030 implements MigrationInterface {
  name = 'CreateMarketSyncConfig1700000000030';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE market_sync_config (
        id SERIAL PRIMARY KEY,
        max_markets_per_cycle INTEGER NOT NULL DEFAULT 10,
        default_fidelity_minutes INTEGER NOT NULL DEFAULT 60,
        expiration_fidelity_minutes INTEGER NOT NULL DEFAULT 1,
        hourly_sync_interval_ms BIGINT NOT NULL DEFAULT 3600000,
        expiration_interval_ms BIGINT NOT NULL DEFAULT 60000,
        tick_retention_days INTEGER NOT NULL DEFAULT 0
      );
    `);
    // Seed a default row so the config always exists.
    await queryRunner.query(`
      INSERT INTO market_sync_config (id, max_markets_per_cycle, default_fidelity_minutes, expiration_fidelity_minutes, hourly_sync_interval_ms, expiration_interval_ms, tick_retention_days)
      VALUES (1, 10, 60, 1, 3600000, 60000, 0)
      ON CONFLICT (id) DO NOTHING;
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS market_sync_config;`);
  }
}
