import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the algo_auto_track_rules table backing the crypto-algo auto-track feature.
 */
export class CreateAlgoAutoTrackRules1700000000008 implements MigrationInterface {
  name = 'CreateAlgoAutoTrackRules1700000000008';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "algo_auto_track_rules" (
        "id" SERIAL PRIMARY KEY NOT NULL,
        "crypto_symbol" text NOT NULL,
        "interval" text NOT NULL,
        "enabled" boolean NOT NULL DEFAULT true,
        "created_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "idx_algo_auto_track_rules_symbol_interval"
      ON "algo_auto_track_rules" ("crypto_symbol", "interval")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_algo_auto_track_rules_enabled"
      ON "algo_auto_track_rules" ("enabled")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "algo_auto_track_rules"`);
  }
}