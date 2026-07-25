import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds a `reason` column to copied_positions to record the originating signal
 * reason (e.g. COPY_OPEN, ALGO_OPEN) for audit and analytics.
 */
export class AddReasonToCopiedPositions1700000000005 implements MigrationInterface {
  name = 'AddReasonToCopiedPositions1700000000005';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "copied_positions"
      ADD COLUMN IF NOT EXISTS "reason" text
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "copied_positions" DROP COLUMN IF EXISTS "reason"`,
    );
  }
}