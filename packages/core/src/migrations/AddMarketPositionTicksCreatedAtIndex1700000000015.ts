import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMarketPositionTicksCreatedAtIndex1700000000015 implements MigrationInterface {
  name = 'AddMarketPositionTicksCreatedAtIndex1700000000015';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_market_position_ticks_created"
      ON "market_position_ticks" ("created_at")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_market_position_ticks_created"`);
  }
}
