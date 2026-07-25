import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds crypto-algo pre-close win-confidence bid threshold.
 * When set, winning positions in the pre-close window are sold if bid < threshold.
 */
export class AddCryptoAlgoPreCloseWinConfidenceBid1700000000020
  implements MigrationInterface
{
  name = 'AddCryptoAlgoPreCloseWinConfidenceBid1700000000020';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "risk_config"
      ADD COLUMN IF NOT EXISTS "crypto_algo_pre_close_win_confidence_bid" real
    `);
    await queryRunner.query(`
      UPDATE "risk_config"
      SET "crypto_algo_pre_close_win_confidence_bid" = 0.85
      WHERE "crypto_algo_pre_close_win_confidence_bid" IS NULL
    `);
    await queryRunner.query(`
      UPDATE "risk_config"
      SET "sim_entry_usdc_amount" = 2
      WHERE "sim_entry_usdc_amount" > "sim_max_position_size_usdc"
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "risk_config" DROP COLUMN IF EXISTS "crypto_algo_pre_close_win_confidence_bid"`,
    );
  }
}
