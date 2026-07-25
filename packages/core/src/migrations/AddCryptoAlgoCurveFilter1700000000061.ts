import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCryptoAlgoCurveFilter1700000000061 implements MigrationInterface {
  name = 'AddCryptoAlgoCurveFilter1700000000061';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE risk_config
        ADD COLUMN IF NOT EXISTS crypto_algo_curve_filter_enabled boolean
    `);
    await queryRunner.query(`
      ALTER TABLE risk_config
        ADD COLUMN IF NOT EXISTS crypto_algo_curve_lookback_ms integer
    `);
    await queryRunner.query(`
      ALTER TABLE risk_config
        ADD COLUMN IF NOT EXISTS crypto_algo_curve_min_delta real
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE risk_config
        DROP COLUMN IF EXISTS crypto_algo_curve_min_delta
    `);
    await queryRunner.query(`
      ALTER TABLE risk_config
        DROP COLUMN IF EXISTS crypto_algo_curve_lookback_ms
    `);
    await queryRunner.query(`
      ALTER TABLE risk_config
        DROP COLUMN IF EXISTS crypto_algo_curve_filter_enabled
    `);
  }
}
