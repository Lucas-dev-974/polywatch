import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCryptoAlgoReEntryConfig1700000000038 implements MigrationInterface {
  name = 'AddCryptoAlgoReEntryConfig1700000000038';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE risk_config
        ADD COLUMN IF NOT EXISTS crypto_algo_reentry_window_ms integer
    `);
    await queryRunner.query(`
      ALTER TABLE risk_config
        ADD COLUMN IF NOT EXISTS crypto_algo_max_entries_per_window integer
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE risk_config
        DROP COLUMN IF EXISTS crypto_algo_max_entries_per_window
    `);
    await queryRunner.query(`
      ALTER TABLE risk_config
        DROP COLUMN IF EXISTS crypto_algo_reentry_window_ms
    `);
  }
}
