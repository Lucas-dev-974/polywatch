import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds COPY_INCREASE SL-proximity guard columns to risk_config.
 *
 * The guard rejects INCREASED copy signals when the existing position is
 * already close to its configured stop-loss threshold.
 */
export class AddCopyIncreaseSlProximity1700000000003 implements MigrationInterface {
  name = 'AddCopyIncreaseSlProximity1700000000003';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "risk_config"
      ADD COLUMN IF NOT EXISTS "sim_copy_increase_sl_proximity_enabled" boolean NOT NULL DEFAULT false
    `);
    await queryRunner.query(`
      ALTER TABLE "risk_config"
      ADD COLUMN IF NOT EXISTS "real_copy_increase_sl_proximity_enabled" boolean NOT NULL DEFAULT false
    `);
    await queryRunner.query(`
      ALTER TABLE "risk_config"
      ADD COLUMN IF NOT EXISTS "sim_copy_increase_sl_proximity_percent" real NOT NULL DEFAULT 80
    `);
    await queryRunner.query(`
      ALTER TABLE "risk_config"
      ADD COLUMN IF NOT EXISTS "real_copy_increase_sl_proximity_percent" real NOT NULL DEFAULT 80
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "risk_config" DROP COLUMN IF EXISTS "sim_copy_increase_sl_proximity_enabled"`);
    await queryRunner.query(`ALTER TABLE "risk_config" DROP COLUMN IF EXISTS "real_copy_increase_sl_proximity_enabled"`);
    await queryRunner.query(`ALTER TABLE "risk_config" DROP COLUMN IF EXISTS "sim_copy_increase_sl_proximity_percent"`);
    await queryRunner.query(`ALTER TABLE "risk_config" DROP COLUMN IF EXISTS "real_copy_increase_sl_proximity_percent"`);
  }
}