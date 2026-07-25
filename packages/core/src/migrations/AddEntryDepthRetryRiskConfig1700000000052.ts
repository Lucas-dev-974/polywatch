import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Entry depth retry settings: re-poll ask book when depth < target shares.
 */
export class AddEntryDepthRetryRiskConfig1700000000052 implements MigrationInterface {
  name = 'AddEntryDepthRetryRiskConfig1700000000052';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "risk_config"
      ADD COLUMN IF NOT EXISTS "sim_entry_depth_retry_max" integer NOT NULL DEFAULT 3
    `);
    await queryRunner.query(`
      ALTER TABLE "risk_config"
      ADD COLUMN IF NOT EXISTS "sim_entry_depth_retry_delay_ms" integer NOT NULL DEFAULT 1000
    `);
    await queryRunner.query(`
      ALTER TABLE "risk_config"
      ADD COLUMN IF NOT EXISTS "real_entry_depth_retry_max" integer NOT NULL DEFAULT 3
    `);
    await queryRunner.query(`
      ALTER TABLE "risk_config"
      ADD COLUMN IF NOT EXISTS "real_entry_depth_retry_delay_ms" integer NOT NULL DEFAULT 1000
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "risk_config" DROP COLUMN IF EXISTS "real_entry_depth_retry_delay_ms"`,
    );
    await queryRunner.query(
      `ALTER TABLE "risk_config" DROP COLUMN IF EXISTS "real_entry_depth_retry_max"`,
    );
    await queryRunner.query(
      `ALTER TABLE "risk_config" DROP COLUMN IF EXISTS "sim_entry_depth_retry_delay_ms"`,
    );
    await queryRunner.query(
      `ALTER TABLE "risk_config" DROP COLUMN IF EXISTS "sim_entry_depth_retry_max"`,
    );
  }
}
