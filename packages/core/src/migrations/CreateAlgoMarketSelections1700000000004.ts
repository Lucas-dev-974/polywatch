import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the algo_market_selections table backing the crypto-algo feature.
 */
export class CreateAlgoMarketSelections1700000000004 implements MigrationInterface {
  name = 'CreateAlgoMarketSelections1700000000004';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "algo_market_selections" (
        "id" SERIAL PRIMARY KEY NOT NULL,
        "condition_id" text NOT NULL,
        "question" text,
        "crypto_symbol" text,
        "interval" text,
        "slug" text,
        "enabled" boolean NOT NULL DEFAULT true,
        "created_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_algo_market_selections_condition"
      ON "algo_market_selections" ("condition_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_algo_market_selections_enabled"
      ON "algo_market_selections" ("enabled")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "algo_market_selections"`);
  }
}