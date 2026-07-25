import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCryptoAlgoPriceTickCleanupConfig1700000000026
  implements MigrationInterface
{
  name = 'AddCryptoAlgoPriceTickCleanupConfig1700000000026';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE risk_config
        ADD COLUMN crypto_algo_price_tick_cleanup_enabled boolean NOT NULL DEFAULT true;
    `);
    await queryRunner.query(`
      ALTER TABLE risk_config
        ADD COLUMN crypto_algo_price_tick_cleanup_interval_minutes integer NOT NULL DEFAULT 60;
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE risk_config
        DROP COLUMN crypto_algo_price_tick_cleanup_interval_minutes;
    `);
    await queryRunner.query(`
      ALTER TABLE risk_config
        DROP COLUMN crypto_algo_price_tick_cleanup_enabled;
    `);
  }
}
