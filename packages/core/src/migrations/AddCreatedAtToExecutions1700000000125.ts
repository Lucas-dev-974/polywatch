import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds executions.created_at so failed/cancelled rows (executed_at NULL)
 * still have a recorded event time for the UI DATE column.
 *
 * executed_at remains fill time only — this does not fake a fill.
 */
export class AddCreatedAtToExecutions1700000000125 implements MigrationInterface {
  name = 'AddCreatedAtToExecutions1700000000125';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE executions
        ADD COLUMN IF NOT EXISTS created_at timestamp NULL
    `);
    await queryRunner.query(`
      UPDATE executions
         SET created_at = executed_at
       WHERE created_at IS NULL
         AND executed_at IS NOT NULL
    `);
    await queryRunner.query(`
      UPDATE executions
         SET created_at = CURRENT_TIMESTAMP
       WHERE created_at IS NULL
    `);
    await queryRunner.query(`
      ALTER TABLE executions
        ALTER COLUMN created_at SET DEFAULT CURRENT_TIMESTAMP
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE executions
        DROP COLUMN IF EXISTS created_at
    `);
  }
}
