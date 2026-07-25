import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Raise sim entry sizing floor so crypto-algo entries can bump to market MOS
 * (effectiveMos × askVwap ≈ 5 USDC on 5m crypto markets).
 */
export class BumpSimAlgoEntrySizing1700000000053 implements MigrationInterface {
  name = 'BumpSimAlgoEntrySizing1700000000053';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "risk_config"
      SET "sim_entry_usdc_amount" = 10
      WHERE "sim_entry_usdc_amount" < 10
    `);
    await queryRunner.query(`
      UPDATE "risk_config"
      SET "sim_max_position_size_usdc" = 15
      WHERE "sim_max_position_size_usdc" < 15
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // Non-destructive: sizing is user-tunable; no automatic rollback.
    void queryRunner;
  }
}
