import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateExitAttemptEvents1700000000036
  implements MigrationInterface
{
  name = 'CreateExitAttemptEvents1700000000036';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "exit_attempt_events" (
        "id" SERIAL NOT NULL,
        "copied_position_id" integer NOT NULL,
        "kind" text NOT NULL,
        "close_reason" text NOT NULL,
        "block_reason" text,
        "error" text,
        "execution_id" integer,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "PK_exit_attempt_events" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_exit_attempt_events_position_created"
      ON "exit_attempt_events" ("copied_position_id", "created_at")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_exit_attempt_events_position_close_reason"
      ON "exit_attempt_events" ("copied_position_id", "close_reason")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_exit_attempt_events_position_close_reason"
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_exit_attempt_events_position_created"
    `);
    await queryRunner.query(`
      DROP TABLE IF EXISTS "exit_attempt_events"
    `);
  }
}
