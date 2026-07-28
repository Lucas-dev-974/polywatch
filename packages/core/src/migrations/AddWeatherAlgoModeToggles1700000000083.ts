import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWeatherAlgoModeToggles1700000000083 implements MigrationInterface {
  name = 'AddWeatherAlgoModeToggles1700000000083';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "risk_config" ADD COLUMN "weather_algo_sim_enabled" BOOLEAN DEFAULT true`,
    );
    await queryRunner.query(
      `ALTER TABLE "risk_config" ADD COLUMN "weather_algo_real_enabled" BOOLEAN DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "risk_config" DROP COLUMN IF EXISTS "weather_algo_real_enabled"`,
    );
    await queryRunner.query(
      `ALTER TABLE "risk_config" DROP COLUMN IF EXISTS "weather_algo_sim_enabled"`,
    );
  }
}