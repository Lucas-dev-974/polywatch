import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCryptoAlgoSlQuotaConfig1700000000044 implements MigrationInterface {
  name = 'AddCryptoAlgoSlQuotaConfig1700000000044';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE risk_config
        ADD COLUMN IF NOT EXISTS crypto_algo_sl_quota_enabled boolean NOT NULL DEFAULT false
    `);
    await queryRunner.query(`
      ALTER TABLE risk_config
        ADD COLUMN IF NOT EXISTS crypto_algo_sl_quota_per_market integer NOT NULL DEFAULT 1
    `);
    await queryRunner.query(`
      ALTER TABLE risk_config
        ADD COLUMN IF NOT EXISTS crypto_algo_sl_quota_cache_ttl_seconds integer NOT NULL DEFAULT 30
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE risk_config
        DROP COLUMN IF EXISTS crypto_algo_sl_quota_cache_ttl_seconds
    `);
    await queryRunner.query(`
      ALTER TABLE risk_config
        DROP COLUMN IF EXISTS crypto_algo_sl_quota_per_market
    `);
    await queryRunner.query(`
      ALTER TABLE risk_config
        DROP COLUMN IF EXISTS crypto_algo_sl_quota_enabled
    `);
  }
}
