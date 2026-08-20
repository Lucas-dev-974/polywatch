import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Supprime la feature de pré-clôture weather-algo (`closeBeforeResolutionHours`
 * + `preCloseEnabled`/`preCloseSeconds`). Les positions weather tiennent jusqu'à
 * résolution (ou SL/TP/dérive/sortie bucket). Les colonnes legacy sont retirées.
 */
export class DropWeatherPreClose1700000000116 implements MigrationInterface {
  name = 'DropWeatherPreClose1700000000116';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "weather_config" DROP COLUMN IF EXISTS "weather_algo_close_before_resolution_hours"`,
    );
    await queryRunner.query(
      `ALTER TABLE "weather_config" DROP COLUMN IF EXISTS "weather_algo_pre_close_enabled"`,
    );
    await queryRunner.query(
      `ALTER TABLE "weather_config" DROP COLUMN IF EXISTS "weather_algo_pre_close_seconds"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "weather_config" ADD COLUMN IF NOT EXISTS "weather_algo_close_before_resolution_hours" REAL DEFAULT 1`,
    );
    await queryRunner.query(
      `ALTER TABLE "weather_config" ADD COLUMN IF NOT EXISTS "weather_algo_pre_close_enabled" BOOLEAN NOT NULL DEFAULT true`,
    );
    await queryRunner.query(
      `ALTER TABLE "weather_config" ADD COLUMN IF NOT EXISTS "weather_algo_pre_close_seconds" INTEGER NOT NULL DEFAULT 60`,
    );
  }
}
