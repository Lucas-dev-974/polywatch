import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCryptoAlgoEntryPriceBand1700000000056 implements MigrationInterface {
  name = 'AddCryptoAlgoEntryPriceBand1700000000056';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE risk_config
        ADD COLUMN IF NOT EXISTS crypto_algo_entry_price_min real
    `);
    await queryRunner.query(`
      ALTER TABLE risk_config
        ADD COLUMN IF NOT EXISTS crypto_algo_entry_price_max real
    `);
    await queryRunner.query(`
      ALTER TABLE risk_config
        ADD COLUMN IF NOT EXISTS crypto_algo_entry_price_band_enabled boolean
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE risk_config
        DROP COLUMN IF EXISTS crypto_algo_entry_price_band_enabled
    `);
    await queryRunner.query(`
      ALTER TABLE risk_config
        DROP COLUMN IF EXISTS crypto_algo_entry_price_max
    `);
    await queryRunner.query(`
      ALTER TABLE risk_config
        DROP COLUMN IF EXISTS crypto_algo_entry_price_min
    `);
  }
}
