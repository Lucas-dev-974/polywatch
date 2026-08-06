import { MigrationInterface, QueryRunner } from 'typeorm';

/** Phase 2.2 — per-strategy JSON params bag on crypto_config. */
export class AddCryptoAlgoStrategyParams1700000000094 implements MigrationInterface {
  name = 'AddCryptoAlgoStrategyParams1700000000094';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "crypto_config"
      ADD COLUMN IF NOT EXISTS "crypto_algo_strategy_params" text NOT NULL DEFAULT '{}'
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "crypto_config"
      DROP COLUMN IF EXISTS "crypto_algo_strategy_params"
    `);
  }
}
