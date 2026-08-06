import { MigrationInterface, QueryRunner } from 'typeorm';

/** Persist crypto-algo post-entry mid samples (adverse selection). */
export class CreatePostEntryMidSamples1700000000095 implements MigrationInterface {
  name = 'CreatePostEntryMidSamples1700000000095';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "post_entry_mid_samples" (
        "id" SERIAL PRIMARY KEY,
        "condition_id" text NOT NULL,
        "outcome" text NOT NULL,
        "position_id" integer,
        "filled_at_ms" bigint NOT NULL,
        "offset_ms" integer NOT NULL,
        "up_mid" real,
        "down_mid" real,
        "sampled_at_ms" bigint NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_post_entry_mid_samples_condition_id"
      ON "post_entry_mid_samples" ("condition_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_post_entry_mid_samples_position_id"
      ON "post_entry_mid_samples" ("position_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_post_entry_mid_samples_sampled_at_ms"
      ON "post_entry_mid_samples" ("sampled_at_ms")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "post_entry_mid_samples"`);
  }
}
