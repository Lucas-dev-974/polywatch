import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Max SL close execution retries per mode when the CLOB has no executable bid
 * or the FAK sell does not match.
 */
export class AddSlCloseMaxRetries1700000000010 implements MigrationInterface {
  name = 'AddSlCloseMaxRetries1700000000010';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "risk_config"
      ADD COLUMN IF NOT EXISTS "sim_sl_close_max_retries" integer NOT NULL DEFAULT 5
    `);
    await queryRunner.query(`
      ALTER TABLE "risk_config"
      ADD COLUMN IF NOT EXISTS "real_sl_close_max_retries" integer NOT NULL DEFAULT 5
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "risk_config" DROP COLUMN IF EXISTS "sim_sl_close_max_retries"
    `);
    await queryRunner.query(`
      ALTER TABLE "risk_config" DROP COLUMN IF EXISTS "real_sl_close_max_retries"
    `);
  }
}
