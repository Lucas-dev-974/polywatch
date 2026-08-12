import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUnitToWeatherPositionForecast1700000000109
  implements MigrationInterface
{
  name = 'AddUnitToWeatherPositionForecast1700000000109';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "weather_position_forecasts" ADD COLUMN "unit" text NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "weather_position_forecasts" DROP COLUMN "unit"`,
    );
  }
}