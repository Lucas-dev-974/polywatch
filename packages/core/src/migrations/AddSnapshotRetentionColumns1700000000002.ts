import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds sim_snapshot_max_count and sim_snapshot_retention_days columns to risk_config.
 * These back the optional retention/purge policy for simulation snapshots.
 */
export class AddSnapshotRetentionColumns1700000000002 implements MigrationInterface {
  name = 'AddSnapshotRetentionColumns1700000000002';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "risk_config"
      ADD COLUMN IF NOT EXISTS "sim_snapshot_max_count" integer
    `);
    await queryRunner.query(`
      ALTER TABLE "risk_config"
      ADD COLUMN IF NOT EXISTS "sim_snapshot_retention_days" integer
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "risk_config"
      DROP COLUMN IF EXISTS "sim_snapshot_retention_days"
    `);
    await queryRunner.query(`
      ALTER TABLE "risk_config"
      DROP COLUMN IF EXISTS "sim_snapshot_max_count"
    `);
  }
}