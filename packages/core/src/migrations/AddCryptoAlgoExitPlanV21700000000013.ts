import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Plan V2: crypto-algo min time to close, last closeable bid tracking,
 * and sensible defaults for crypto-algo exit params.
 */
export class AddCryptoAlgoExitPlanV21700000000013 implements MigrationInterface {
  name = 'AddCryptoAlgoExitPlanV21700000000013';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "risk_config"
      ADD COLUMN IF NOT EXISTS "crypto_algo_min_time_to_close" integer
    `);

    await queryRunner.query(`
      ALTER TABLE "copied_positions"
      ADD COLUMN IF NOT EXISTS "last_closeable_bid_vwap" real
    `);
    await queryRunner.query(`
      ALTER TABLE "copied_positions"
      ADD COLUMN IF NOT EXISTS "last_closeable_bid_at" timestamp
    `);

    // Phase 0 defaults — only where still unset (null).
    await queryRunner.query(`
      UPDATE "risk_config"
      SET "crypto_algo_pre_close_enabled" = true
      WHERE "crypto_algo_pre_close_enabled" IS NULL
    `);
    await queryRunner.query(`
      UPDATE "risk_config"
      SET "crypto_algo_pre_close_seconds" = 120
      WHERE "crypto_algo_pre_close_seconds" IS NULL
    `);
    await queryRunner.query(`
      UPDATE "risk_config"
      SET "crypto_algo_pre_close_hold_if_winning" = true
      WHERE "crypto_algo_pre_close_hold_if_winning" IS NULL
    `);
    await queryRunner.query(`
      UPDATE "risk_config"
      SET "crypto_algo_sl_percent" = 18
      WHERE "crypto_algo_sl_percent" IS NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "copied_positions" DROP COLUMN IF EXISTS "last_closeable_bid_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "copied_positions" DROP COLUMN IF EXISTS "last_closeable_bid_vwap"`,
    );
    await queryRunner.query(
      `ALTER TABLE "risk_config" DROP COLUMN IF EXISTS "crypto_algo_min_time_to_close"`,
    );
  }
}