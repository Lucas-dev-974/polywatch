import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Add a master toggle for crypto-algo market recording & listening.
 * When OFF, the crypto-algo process stops WebSocket subscription, polling
 * and price/surveillance recording on its markets.
 */
export class AddCryptoAlgoRecordingToggle1700000000113 implements MigrationInterface {
  name = 'AddCryptoAlgoRecordingToggle1700000000113';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "crypto_config"
        ADD COLUMN IF NOT EXISTS "crypto_algo_recording_enabled" boolean NOT NULL DEFAULT true
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "crypto_config" DROP COLUMN IF EXISTS "crypto_algo_recording_enabled"
    `);
  }
}
