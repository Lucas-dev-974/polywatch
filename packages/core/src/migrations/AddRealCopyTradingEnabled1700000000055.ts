import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds real_copy_trading_enabled master toggle to risk_config.
 * Default true preserves existing copy-trading real behavior.
 */
export class AddRealCopyTradingEnabled1700000000055 implements MigrationInterface {
  name = 'AddRealCopyTradingEnabled1700000000055';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "risk_config"
      ADD COLUMN IF NOT EXISTS "real_copy_trading_enabled" boolean NOT NULL DEFAULT true
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "risk_config" DROP COLUMN IF EXISTS "real_copy_trading_enabled"`,
    );
  }
}
