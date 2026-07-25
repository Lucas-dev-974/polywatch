import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds crypto-algo pre-close override columns to risk_config.
 * Null values inherit the active sim/real mode defaults.
 */
export class AddCryptoAlgoPreCloseRiskConfig1700000000012 implements MigrationInterface {
  name = 'AddCryptoAlgoPreCloseRiskConfig1700000000012';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "risk_config"
      ADD COLUMN IF NOT EXISTS "crypto_algo_pre_close_enabled" boolean
    `);
    await queryRunner.query(`
      ALTER TABLE "risk_config"
      ADD COLUMN IF NOT EXISTS "crypto_algo_pre_close_seconds" integer
    `);
    await queryRunner.query(`
      ALTER TABLE "risk_config"
      ADD COLUMN IF NOT EXISTS "crypto_algo_pre_close_hold_if_winning" boolean
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "risk_config" DROP COLUMN IF EXISTS "crypto_algo_pre_close_hold_if_winning"`,
    );
    await queryRunner.query(
      `ALTER TABLE "risk_config" DROP COLUMN IF EXISTS "crypto_algo_pre_close_seconds"`,
    );
    await queryRunner.query(
      `ALTER TABLE "risk_config" DROP COLUMN IF EXISTS "crypto_algo_pre_close_enabled"`,
    );
  }
}