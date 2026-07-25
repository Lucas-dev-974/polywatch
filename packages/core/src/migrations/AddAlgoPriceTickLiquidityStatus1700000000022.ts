import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAlgoPriceTickLiquidityStatus1700000000022 implements MigrationInterface {
  name = 'AddAlgoPriceTickLiquidityStatus1700000000022';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "algo_price_ticks"
        ADD COLUMN IF NOT EXISTS "up_liquidity_status" text,
        ADD COLUMN IF NOT EXISTS "down_liquidity_status" text
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "algo_price_ticks"
        DROP COLUMN IF EXISTS "up_liquidity_status",
        DROP COLUMN IF EXISTS "down_liquidity_status"
    `);
  }
}
