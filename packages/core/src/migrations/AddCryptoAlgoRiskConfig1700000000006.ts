import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds crypto-algo strategy columns to risk_config:
 *  - crypto_algo_enabled (master toggle)
 *  - crypto_algo_strategies (JSON array of strategy ids)
 *  - crypto_algo_sl_percent / tp_percent / trailing_stop_percent /
 *    trailing_activation_percent (override exit params; null = use mode defaults)
 */
export class AddCryptoAlgoRiskConfig1700000000006 implements MigrationInterface {
  name = 'AddCryptoAlgoRiskConfig1700000000006';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "risk_config"
      ADD COLUMN IF NOT EXISTS "crypto_algo_enabled" boolean NOT NULL DEFAULT false
    `);
    await queryRunner.query(`
      ALTER TABLE "risk_config"
      ADD COLUMN IF NOT EXISTS "crypto_algo_strategies" text NOT NULL DEFAULT '["naive-momentum"]'
    `);
    await queryRunner.query(`
      ALTER TABLE "risk_config"
      ADD COLUMN IF NOT EXISTS "crypto_algo_sl_percent" real
    `);
    await queryRunner.query(`
      ALTER TABLE "risk_config"
      ADD COLUMN IF NOT EXISTS "crypto_algo_tp_percent" real
    `);
    await queryRunner.query(`
      ALTER TABLE "risk_config"
      ADD COLUMN IF NOT EXISTS "crypto_algo_trailing_stop_percent" real
    `);
    await queryRunner.query(`
      ALTER TABLE "risk_config"
      ADD COLUMN IF NOT EXISTS "crypto_algo_trailing_activation_percent" real
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "risk_config" DROP COLUMN IF EXISTS "crypto_algo_trailing_activation_percent"`,
    );
    await queryRunner.query(
      `ALTER TABLE "risk_config" DROP COLUMN IF EXISTS "crypto_algo_trailing_stop_percent"`,
    );
    await queryRunner.query(
      `ALTER TABLE "risk_config" DROP COLUMN IF EXISTS "crypto_algo_tp_percent"`,
    );
    await queryRunner.query(
      `ALTER TABLE "risk_config" DROP COLUMN IF EXISTS "crypto_algo_sl_percent"`,
    );
    await queryRunner.query(
      `ALTER TABLE "risk_config" DROP COLUMN IF EXISTS "crypto_algo_strategies"`,
    );
    await queryRunner.query(
      `ALTER TABLE "risk_config" DROP COLUMN IF EXISTS "crypto_algo_enabled"`,
    );
  }
}