import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * P4 — Add sl_confirmation_ticks to risk_config.
 * Configures how many consecutive evaluations must confirm SL before emitting.
 */
export class AddSlConfirmationTicksRiskConfig1700000000033 implements MigrationInterface {
  name = 'AddSlConfirmationTicksRiskConfig1700000000033';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "risk_config"
        ADD COLUMN IF NOT EXISTS "sl_confirmation_ticks" integer NOT NULL DEFAULT 2
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "risk_config"
        DROP COLUMN IF EXISTS "sl_confirmation_ticks"
    `);
  }
}
