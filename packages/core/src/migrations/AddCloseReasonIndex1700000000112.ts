import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Add an index on copied_positions.close_reason for analytics queries
 * (weather-algo history, close-reason breakdowns).
 */
export class AddCloseReasonIndex1700000000112 implements MigrationInterface {
  name = 'AddCloseReasonIndex1700000000112';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_copied_positions_close_reason"
      ON "copied_positions" ("close_reason")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_copied_positions_close_reason"
    `);
  }
}