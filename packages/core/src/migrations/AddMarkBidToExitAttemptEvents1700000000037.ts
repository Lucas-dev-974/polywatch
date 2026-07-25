import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMarkBidToExitAttemptEvents1700000000037
  implements MigrationInterface
{
  name = 'AddMarkBidToExitAttemptEvents1700000000037';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "exit_attempt_events"
      ADD COLUMN IF NOT EXISTS "mark_bid" real
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "exit_attempt_events"
      DROP COLUMN IF EXISTS "mark_bid"
    `);
  }
}
