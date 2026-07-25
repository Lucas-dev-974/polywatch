import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * P0 — Reset crypto-algo exit overrides so interval defaults apply (5m: SL 12 %, TP 45 %).
 */
export class AddCryptoAlgoExitDefaults1700000000024 implements MigrationInterface {
  name = 'AddCryptoAlgoExitDefaults1700000000024';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "risk_config"
      SET
        "crypto_algo_sl_percent" = NULL,
        "crypto_algo_tp_percent" = NULL,
        "crypto_algo_trailing_stop_percent" = NULL,
        "crypto_algo_trailing_activation_percent" = NULL,
        "crypto_algo_pre_close_hold_if_winning" = false,
        "crypto_algo_pre_close_enabled" = true,
        "crypto_algo_pre_close_seconds" = NULL,
        "crypto_algo_time_exit_enabled" = true
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "risk_config"
      SET
        "crypto_algo_sl_percent" = 15,
        "crypto_algo_tp_percent" = 50,
        "crypto_algo_trailing_stop_percent" = 15,
        "crypto_algo_trailing_activation_percent" = 10,
        "crypto_algo_pre_close_hold_if_winning" = true
    `);
  }
}
