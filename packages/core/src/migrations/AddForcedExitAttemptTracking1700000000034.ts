import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddForcedExitAttemptTracking1700000000034
  implements MigrationInterface
{
  name = 'AddForcedExitAttemptTracking1700000000034';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "copied_positions"
      ADD COLUMN IF NOT EXISTS "forced_exit_failed_attempts" integer NOT NULL DEFAULT 0
    `);
    await queryRunner.query(`
      ALTER TABLE "copied_positions"
      ADD COLUMN IF NOT EXISTS "last_forced_exit_attempt_at" TIMESTAMP WITH TIME ZONE
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "copied_positions"
      DROP COLUMN IF EXISTS "last_forced_exit_attempt_at"
    `);
    await queryRunner.query(`
      ALTER TABLE "copied_positions"
      DROP COLUMN IF EXISTS "forced_exit_failed_attempts"
    `);
  }
}
