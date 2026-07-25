import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateE2eRunPositions1700000000017 implements MigrationInterface {
  name = 'CreateE2eRunPositions1700000000017';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "e2e_run_positions" (
        "id" text PRIMARY KEY NOT NULL,
        "run_id" text NOT NULL,
        "condition_id" text NOT NULL,
        "market_question" text,
        "crypto_symbol" text,
        "interval" text,
        "outcome" text NOT NULL,
        "side" text NOT NULL,
        "entry_price" real NOT NULL,
        "quantity" real NOT NULL,
        "current_price" real,
        "pnl_percent" real,
        "realized_pnl" real,
        "status" text NOT NULL,
        "close_reason" text,
        "opened_at" timestamp NOT NULL,
        "closed_at" timestamp
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_e2e_run_positions_run_id"
      ON "e2e_run_positions" ("run_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_e2e_run_positions_condition_id"
      ON "e2e_run_positions" ("condition_id")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "e2e_run_positions"`);
  }
}