import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds fixed_shares sizing config: integer share count per entry (sim + real).
 */
export class AddEntryShareCountRiskConfig1700000000050 implements MigrationInterface {
  name = 'AddEntryShareCountRiskConfig1700000000050';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "risk_config"
      ADD COLUMN IF NOT EXISTS "sim_entry_share_count" integer NOT NULL DEFAULT 5
    `);
    await queryRunner.query(`
      ALTER TABLE "risk_config"
      ADD COLUMN IF NOT EXISTS "real_entry_share_count" integer NOT NULL DEFAULT 5
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "risk_config" DROP COLUMN IF EXISTS "real_entry_share_count"`,
    );
    await queryRunner.query(
      `ALTER TABLE "risk_config" DROP COLUMN IF EXISTS "sim_entry_share_count"`,
    );
  }
}
