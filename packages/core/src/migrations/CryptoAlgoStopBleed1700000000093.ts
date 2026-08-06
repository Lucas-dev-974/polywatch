import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 0 stop-bleeding for crypto-algo:
 * - disable SL jambe (shared sim/real flag)
 * - keep TP enabled
 * - raise entry band floor to 0.55 (coin-flip veto)
 * - disable 24h algo_price_ticks purge (export dataset first)
 * - ensure USDC sizing ≥ 2× MIN_ORDER_USDC when in fixed_usdc mode
 */
export class CryptoAlgoStopBleed1700000000093 implements MigrationInterface {
  name = 'CryptoAlgoStopBleed1700000000093';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "crypto_config"
      SET
        "crypto_algo_sl_enabled" = false,
        "crypto_algo_tp_enabled" = true,
        "crypto_algo_price_tick_cleanup_enabled" = false,
        "crypto_algo_entry_price_band_enabled" = COALESCE("crypto_algo_entry_price_band_enabled", true),
        "crypto_algo_entry_price_min" = CASE
          WHEN "crypto_algo_entry_price_min" IS NULL OR "crypto_algo_entry_price_min" < 0.55
          THEN 0.55
          ELSE "crypto_algo_entry_price_min"
        END,
        "crypto_algo_entry_usdc_amount" = CASE
          WHEN "crypto_algo_sizing_mode" = 'fixed_usdc'
            AND ("crypto_algo_entry_usdc_amount" IS NULL OR "crypto_algo_entry_usdc_amount" < 2)
          THEN 2
          ELSE "crypto_algo_entry_usdc_amount"
        END,
        "crypto_algo_entry_share_count" = CASE
          WHEN "crypto_algo_sizing_mode" = 'fixed_shares'
            AND ("crypto_algo_entry_share_count" IS NULL OR "crypto_algo_entry_share_count" < 2)
          THEN 2
          ELSE "crypto_algo_entry_share_count"
        END
    `);

    await queryRunner.query(`
      ALTER TABLE "crypto_config"
        ALTER COLUMN "crypto_algo_sl_enabled" SET DEFAULT false
    `);
    await queryRunner.query(`
      ALTER TABLE "crypto_config"
        ALTER COLUMN "crypto_algo_price_tick_cleanup_enabled" SET DEFAULT false
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "crypto_config"
        ALTER COLUMN "crypto_algo_sl_enabled" SET DEFAULT true
    `);
    await queryRunner.query(`
      ALTER TABLE "crypto_config"
        ALTER COLUMN "crypto_algo_price_tick_cleanup_enabled" SET DEFAULT true
    `);
  }
}
