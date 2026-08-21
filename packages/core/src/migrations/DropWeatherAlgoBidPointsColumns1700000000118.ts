import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Supprime les colonnes legacy `weatherAlgoSlBidPoints` / `TpBidPoints` /
 * `TrailingBidPoints` / `TrailingActivationBidPoints` de `weather_config`.
 *
 * Ces colonnes ne sont plus lues ni écrites depuis la migration SL/TP vers
 * des pourcentages de la mise investie (`slPercent` / `tpPercent` / etc. sur
 * `WeatherStrategyParamsBag`). Les seuils sont désormais résolus par stratégie
 * via `resolveWeatherEntryExitParams` et stockés sur `CopiedPosition`.
 */
export class DropWeatherAlgoBidPointsColumns1700000000118
  implements MigrationInterface
{
  name = 'DropWeatherAlgoBidPointsColumns1700000000118';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "weather_config" DROP COLUMN IF EXISTS "weather_algo_sl_bid_points"`,
    );
    await queryRunner.query(
      `ALTER TABLE "weather_config" DROP COLUMN IF EXISTS "weather_algo_tp_bid_points"`,
    );
    await queryRunner.query(
      `ALTER TABLE "weather_config" DROP COLUMN IF EXISTS "weather_algo_trailing_bid_points"`,
    );
    await queryRunner.query(
      `ALTER TABLE "weather_config" DROP COLUMN IF EXISTS "weather_algo_trailing_activation_bid_points"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "weather_config" ADD COLUMN IF NOT EXISTS "weather_algo_sl_bid_points" REAL`,
    );
    await queryRunner.query(
      `ALTER TABLE "weather_config" ADD COLUMN IF NOT EXISTS "weather_algo_tp_bid_points" REAL`,
    );
    await queryRunner.query(
      `ALTER TABLE "weather_config" ADD COLUMN IF NOT EXISTS "weather_algo_trailing_bid_points" REAL`,
    );
    await queryRunner.query(
      `ALTER TABLE "weather_config" ADD COLUMN IF NOT EXISTS "weather_algo_trailing_activation_bid_points" REAL`,
    );
  }
}