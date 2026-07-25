import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAlgoPriceTicks1700000000019 implements MigrationInterface {
  name = 'CreateAlgoPriceTicks1700000000019';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "algo_price_ticks" (
        "id" SERIAL PRIMARY KEY NOT NULL,
        "condition_id" text NOT NULL,
        "up_price" real,
        "down_price" real,
        "recorded_at" timestamp NOT NULL,
        "created_at" timestamp NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_algo_price_ticks_condition_id"
      ON "algo_price_ticks" ("condition_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_algo_price_ticks_recorded_at"
      ON "algo_price_ticks" ("recorded_at")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "algo_price_ticks"`);
  }
}