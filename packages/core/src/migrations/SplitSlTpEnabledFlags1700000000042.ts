import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Split coupled SL/TP master toggles into independent enable flags for copy
 * (sim/real) and crypto-algo exit legs.
 */
export class SplitSlTpEnabledFlags1700000000042 implements MigrationInterface {
  name = 'SplitSlTpEnabledFlags1700000000042';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "risk_config"
        ADD COLUMN IF NOT EXISTS "sim_sl_enabled" boolean NOT NULL DEFAULT true
    `);
    await queryRunner.query(`
      ALTER TABLE "risk_config"
        ADD COLUMN IF NOT EXISTS "sim_tp_enabled" boolean NOT NULL DEFAULT true
    `);
    await queryRunner.query(`
      ALTER TABLE "risk_config"
        ADD COLUMN IF NOT EXISTS "real_sl_enabled" boolean NOT NULL DEFAULT true
    `);
    await queryRunner.query(`
      ALTER TABLE "risk_config"
        ADD COLUMN IF NOT EXISTS "real_tp_enabled" boolean NOT NULL DEFAULT true
    `);
    await queryRunner.query(`
      ALTER TABLE "risk_config"
        ADD COLUMN IF NOT EXISTS "crypto_algo_sl_enabled" boolean NOT NULL DEFAULT true
    `);
    await queryRunner.query(`
      ALTER TABLE "risk_config"
        ADD COLUMN IF NOT EXISTS "crypto_algo_tp_enabled" boolean NOT NULL DEFAULT true
    `);
    await queryRunner.query(`
      ALTER TABLE "risk_config"
        ADD COLUMN IF NOT EXISTS "crypto_algo_trailing_enabled" boolean NOT NULL DEFAULT true
    `);

    // Preserve previous coupled toggle semantics when legacy columns exist.
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'risk_config' AND column_name = 'sim_sl_tp_enabled'
        ) THEN
          UPDATE "risk_config"
          SET
            "sim_sl_enabled" = "sim_sl_tp_enabled",
            "sim_tp_enabled" = "sim_sl_tp_enabled";
        END IF;
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'risk_config' AND column_name = 'real_sl_tp_enabled'
        ) THEN
          UPDATE "risk_config"
          SET
            "real_sl_enabled" = "real_sl_tp_enabled",
            "real_tp_enabled" = "real_sl_tp_enabled";
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      ALTER TABLE "risk_config"
        DROP COLUMN IF EXISTS "sim_sl_tp_enabled"
    `);
    await queryRunner.query(`
      ALTER TABLE "risk_config"
        DROP COLUMN IF EXISTS "real_sl_tp_enabled"
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "risk_config"
        ADD COLUMN IF NOT EXISTS "sim_sl_tp_enabled" boolean NOT NULL DEFAULT true
    `);
    await queryRunner.query(`
      ALTER TABLE "risk_config"
        ADD COLUMN IF NOT EXISTS "real_sl_tp_enabled" boolean NOT NULL DEFAULT true
    `);
    await queryRunner.query(`
      UPDATE "risk_config"
      SET
        "sim_sl_tp_enabled" = ("sim_sl_enabled" AND "sim_tp_enabled"),
        "real_sl_tp_enabled" = ("real_sl_enabled" AND "real_tp_enabled")
    `);

    await queryRunner.query(`
      ALTER TABLE "risk_config"
        DROP COLUMN IF EXISTS "sim_sl_enabled"
    `);
    await queryRunner.query(`
      ALTER TABLE "risk_config"
        DROP COLUMN IF EXISTS "sim_tp_enabled"
    `);
    await queryRunner.query(`
      ALTER TABLE "risk_config"
        DROP COLUMN IF EXISTS "real_sl_enabled"
    `);
    await queryRunner.query(`
      ALTER TABLE "risk_config"
        DROP COLUMN IF EXISTS "real_tp_enabled"
    `);
    await queryRunner.query(`
      ALTER TABLE "risk_config"
        DROP COLUMN IF EXISTS "crypto_algo_sl_enabled"
    `);
    await queryRunner.query(`
      ALTER TABLE "risk_config"
        DROP COLUMN IF EXISTS "crypto_algo_tp_enabled"
    `);
    await queryRunner.query(`
      ALTER TABLE "risk_config"
        DROP COLUMN IF EXISTS "crypto_algo_trailing_enabled"
    `);
  }
}
