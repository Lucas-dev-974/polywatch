import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * P3 — Add SL/TP in absolute bid points for crypto-algo binary markets.
 * Adds columns to store unresolved points (sl_bid_points, tp_bid_points)
 * and resolved absolute thresholds (sl_bid_absolute, tp_bid_absolute).
 */
export class AddCryptoAlgoBidAbsoluteSlTp1700000000025 implements MigrationInterface {
  name = 'AddCryptoAlgoBidAbsoluteSlTp1700000000025';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "copied_positions"
        ADD COLUMN IF NOT EXISTS "sl_bid_points" real
    `);
    await queryRunner.query(`
      ALTER TABLE "copied_positions"
        ADD COLUMN IF NOT EXISTS "tp_bid_points" real
    `);
    await queryRunner.query(`
      ALTER TABLE "copied_positions"
        ADD COLUMN IF NOT EXISTS "sl_bid_absolute" real
    `);
    await queryRunner.query(`
      ALTER TABLE "copied_positions"
        ADD COLUMN IF NOT EXISTS "tp_bid_absolute" real
    `);
    await queryRunner.query(`
      ALTER TABLE "risk_config"
        ADD COLUMN IF NOT EXISTS "crypto_algo_sl_bid_points" real
    `);
    await queryRunner.query(`
      ALTER TABLE "risk_config"
        ADD COLUMN IF NOT EXISTS "crypto_algo_tp_bid_points" real
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "copied_positions"
        DROP COLUMN IF EXISTS "sl_bid_points"
    `);
    await queryRunner.query(`
      ALTER TABLE "copied_positions"
        DROP COLUMN IF EXISTS "tp_bid_points"
    `);
    await queryRunner.query(`
      ALTER TABLE "copied_positions"
        DROP COLUMN IF EXISTS "sl_bid_absolute"
    `);
    await queryRunner.query(`
      ALTER TABLE "copied_positions"
        DROP COLUMN IF EXISTS "tp_bid_absolute"
    `);
    await queryRunner.query(`
      ALTER TABLE "risk_config"
        DROP COLUMN IF EXISTS "crypto_algo_sl_bid_points"
    `);
    await queryRunner.query(`
      ALTER TABLE "risk_config"
        DROP COLUMN IF EXISTS "crypto_algo_tp_bid_points"
    `);
  }
}
