import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAlgoSurveillanceSnapshots1700000000009 implements MigrationInterface {
  name = 'CreateAlgoSurveillanceSnapshots1700000000009';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "algo_surveillance_snapshots" (
        "id" SERIAL PRIMARY KEY NOT NULL,
        "condition_id" text NOT NULL,
        "question" text,
        "crypto_symbol" text,
        "interval" text,
        "slug" text,
        "market_start_at" timestamp,
        "market_end_at" timestamp,
        "open_up_price" real,
        "open_down_price" real,
        "open_captured_at" timestamp,
        "close_up_price" real,
        "close_down_price" real,
        "close_captured_at" timestamp,
        "winning_outcome" text,
        "created_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "idx_algo_surveillance_snapshots_condition_id"
      ON "algo_surveillance_snapshots" ("condition_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_algo_surveillance_snapshots_market_start"
      ON "algo_surveillance_snapshots" ("market_start_at")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_algo_surveillance_snapshots_close_captured"
      ON "algo_surveillance_snapshots" ("close_captured_at")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "algo_surveillance_snapshots"`);
  }
}