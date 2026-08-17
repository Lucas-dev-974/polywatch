import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Add weather_algo_entry_share_count column to weather_config table.
 * Used when sizingMode = 'fixed_shares' to specify the fixed number of shares per entry.
 */
export class AddWeatherAlgoEntryShareCount1700000000111 implements MigrationInterface {
  name = 'AddWeatherAlgoEntryShareCount1700000000111';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "weather_config"
        ADD COLUMN IF NOT EXISTS "weather_algo_entry_share_count" integer DEFAULT 100
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "weather_config" DROP COLUMN IF EXISTS "weather_algo_entry_share_count"
    `);
  }
}