import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds `slippage_percent` to the `executions` table so that the detected
 * slippage at rejection time (e.g. slippage_exceeded) can be surfaced on the
 * market chart signal markers. NULL for executions that were never evaluated
 * against the guard (no referenceVwap) or for legacy rows.
 */
export class AddSlippagePercentToExecutions1700000000060 implements MigrationInterface {
  name = 'AddSlippagePercentToExecutions1700000000060';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE executions
        ADD COLUMN IF NOT EXISTS slippage_percent real NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE executions
        DROP COLUMN IF EXISTS slippage_percent
    `);
  }
}