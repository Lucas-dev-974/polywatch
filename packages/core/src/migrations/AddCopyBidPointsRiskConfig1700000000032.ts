import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * P3 — Add SL/TP in absolute bid points for copy trading on binary markets.
 * Adds columns to risk_config for sim and real mode bid points.
 */
export class AddCopyBidPointsRiskConfig1700000000032 implements MigrationInterface {
  name = 'AddCopyBidPointsRiskConfig1700000000032';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "risk_config"
        ADD COLUMN IF NOT EXISTS "sim_sl_bid_points" real NOT NULL DEFAULT 0.10
    `);
    await queryRunner.query(`
      ALTER TABLE "risk_config"
        ADD COLUMN IF NOT EXISTS "sim_tp_bid_points" real NOT NULL DEFAULT 0.12
    `);
    await queryRunner.query(`
      ALTER TABLE "risk_config"
        ADD COLUMN IF NOT EXISTS "real_sl_bid_points" real NOT NULL DEFAULT 0.10
    `);
    await queryRunner.query(`
      ALTER TABLE "risk_config"
        ADD COLUMN IF NOT EXISTS "real_tp_bid_points" real NOT NULL DEFAULT 0.12
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "risk_config"
        DROP COLUMN IF EXISTS "sim_sl_bid_points"
    `);
    await queryRunner.query(`
      ALTER TABLE "risk_config"
        DROP COLUMN IF EXISTS "sim_tp_bid_points"
    `);
    await queryRunner.query(`
      ALTER TABLE "risk_config"
        DROP COLUMN IF EXISTS "real_sl_bid_points"
    `);
    await queryRunner.query(`
      ALTER TABLE "risk_config"
        DROP COLUMN IF EXISTS "real_tp_bid_points"
    `);
  }
}
