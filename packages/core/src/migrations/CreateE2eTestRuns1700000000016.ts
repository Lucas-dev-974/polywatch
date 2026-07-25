import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateE2eTestRuns1700000000016 implements MigrationInterface {
  name = 'CreateE2eTestRuns1700000000016';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "e2e_test_runs" (
        "id" text PRIMARY KEY NOT NULL,
        "suite" text NOT NULL,
        "status" text NOT NULL,
        "started_at" timestamp NOT NULL,
        "finished_at" timestamp,
        "duration_ms" integer,
        "exit_code" integer,
        "summary" text,
        "log_file_path" text NOT NULL,
        "triggered_by" text,
        "error_message" text
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_e2e_test_runs_started_at"
      ON "e2e_test_runs" ("started_at" DESC)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_e2e_test_runs_status"
      ON "e2e_test_runs" ("status")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "e2e_test_runs"`);
  }
}