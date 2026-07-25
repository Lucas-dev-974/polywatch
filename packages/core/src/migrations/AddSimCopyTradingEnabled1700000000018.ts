import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds sim_copy_trading_enabled master toggle to risk_config.
 * Default true preserves existing copy-trading sim behavior.
 */
export class AddSimCopyTradingEnabled1700000000018 implements MigrationInterface {
  name = 'AddSimCopyTradingEnabled1700000000018';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "risk_config"
      ADD COLUMN IF NOT EXISTS "sim_copy_trading_enabled" boolean NOT NULL DEFAULT true
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "risk_config" DROP COLUMN IF EXISTS "sim_copy_trading_enabled"`,
    );
  }
}