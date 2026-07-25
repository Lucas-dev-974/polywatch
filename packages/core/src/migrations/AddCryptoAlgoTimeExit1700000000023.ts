import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds crypto-algo hard time-exit configuration columns and sensible defaults.
 */
export class AddCryptoAlgoTimeExit1700000000023 implements MigrationInterface {
  name = 'AddCryptoAlgoTimeExit1700000000023';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "risk_config"
      ADD COLUMN IF NOT EXISTS "crypto_algo_time_exit_enabled" boolean,
      ADD COLUMN IF NOT EXISTS "crypto_algo_time_exit_seconds" integer,
      ADD COLUMN IF NOT EXISTS "crypto_algo_time_exit_win_confidence_bid" real,
      ADD COLUMN IF NOT EXISTS "crypto_algo_time_exit_max_retries" integer,
      ADD COLUMN IF NOT EXISTS "crypto_algo_time_exit_last_trade_max_age_seconds" integer
    `);

    await queryRunner.query(`
      UPDATE "risk_config"
      SET
        "crypto_algo_time_exit_enabled" = COALESCE("crypto_algo_time_exit_enabled", true),
        "crypto_algo_time_exit_win_confidence_bid" = COALESCE(
          "crypto_algo_time_exit_win_confidence_bid",
          "crypto_algo_pre_close_win_confidence_bid",
          0.95
        ),
        "crypto_algo_pre_close_hold_if_winning" = COALESCE("crypto_algo_pre_close_hold_if_winning", false),
        "crypto_algo_trailing_stop_percent" = COALESCE("crypto_algo_trailing_stop_percent", 20),
        "crypto_algo_trailing_activation_percent" = COALESCE("crypto_algo_trailing_activation_percent", 10)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "risk_config"
      DROP COLUMN IF EXISTS "crypto_algo_time_exit_last_trade_max_age_seconds",
      DROP COLUMN IF EXISTS "crypto_algo_time_exit_max_retries",
      DROP COLUMN IF EXISTS "crypto_algo_time_exit_win_confidence_bid",
      DROP COLUMN IF EXISTS "crypto_algo_time_exit_seconds",
      DROP COLUMN IF EXISTS "crypto_algo_time_exit_enabled"
    `);
  }
}
