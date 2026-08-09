import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWeatherAlgoStrategies1700000000102 implements MigrationInterface {
  name = 'AddWeatherAlgoStrategies1700000000102';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "weather_config"
      ADD COLUMN "weather_algo_strategies" text NOT NULL DEFAULT '["weather-forecast"]'
    `);
    await queryRunner.query(`
      ALTER TABLE "weather_config"
      ADD COLUMN "weather_algo_strategy_params" text NOT NULL DEFAULT '{}'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "weather_config" DROP COLUMN IF EXISTS "weather_algo_strategy_params"`,
    );
    await queryRunner.query(
      `ALTER TABLE "weather_config" DROP COLUMN IF EXISTS "weather_algo_strategies"`,
    );
  }
}
