import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWeatherStrategyId1700000000106 implements MigrationInterface {
  name = 'AddWeatherStrategyId1700000000106';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "copied_positions" ADD COLUMN "strategy_id" varchar NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_copied_positions_strategy_id" ON "copied_positions" ("strategy_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "weather_position_forecasts" ADD COLUMN "strategy_id" varchar NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "weather_position_forecasts" DROP COLUMN IF EXISTS "strategy_id"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_copied_positions_strategy_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "copied_positions" DROP COLUMN IF EXISTS "strategy_id"`,
    );
  }
}
