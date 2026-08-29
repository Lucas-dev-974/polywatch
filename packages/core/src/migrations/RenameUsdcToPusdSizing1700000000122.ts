import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Renames the sizing/risk columns and stored values from USDC to pUSD across
 * the three config tables (weather_config, copy_config, crypto_config), and
 * migrates the weather strategy JSON bag keys from `*Usdc` to `*Pusd`.
 *
 * Up:
 *  - Rename 4 weather_config columns, 10 copy_config columns, 4 crypto_config
 *    columns (`*_usdc*` → `*_pusd*`).
 *  - UPDATE the 4 `*_sizing_mode` columns from `'fixed_usdc'` to `'fixed_pusd'`.
 *  - ALTER the 4 `*_sizing_mode` column defaults to `'fixed_pusd'`.
 *  - Rewrite the weather strategy JSON bag keys (`entryUsdc`→`entryPusd`, …)
 *    in the 3 params columns (idempotent: existing `*Pusd` keys are kept).
 *  - Rewrite bag `sizingMode: 'fixed_usdc'` → `'fixed_pusd'`.
 *
 * Down: reverse operations.
 */
export class RenameUsdcToPusdSizing1700000000122 implements MigrationInterface {
  name = 'RenameUsdcToPusdSizing1700000000122';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. weather_config columns
    await queryRunner.query(
      `ALTER TABLE "weather_config" RENAME COLUMN "weather_algo_entry_usdc" TO "weather_algo_entry_pusd"`,
    );
    await queryRunner.query(
      `ALTER TABLE "weather_config" RENAME COLUMN "weather_algo_max_exposure_usdc" TO "weather_algo_max_exposure_pusd"`,
    );
    await queryRunner.query(
      `ALTER TABLE "weather_config" RENAME COLUMN "weather_algo_max_daily_loss_usdc" TO "weather_algo_max_daily_loss_pusd"`,
    );
    await queryRunner.query(
      `ALTER TABLE "weather_config" RENAME COLUMN "weather_algo_max_position_size_usdc" TO "weather_algo_max_position_size_pusd"`,
    );

    // 2. copy_config columns
    await queryRunner.query(
      `ALTER TABLE "copy_config" RENAME COLUMN "sim_entry_usdc_amount" TO "sim_entry_pusd_amount"`,
    );
    await queryRunner.query(
      `ALTER TABLE "copy_config" RENAME COLUMN "real_entry_usdc_amount" TO "real_entry_pusd_amount"`,
    );
    await queryRunner.query(
      `ALTER TABLE "copy_config" RENAME COLUMN "sim_risk_budget_usdc" TO "sim_risk_budget_pusd"`,
    );
    await queryRunner.query(
      `ALTER TABLE "copy_config" RENAME COLUMN "real_risk_budget_usdc" TO "real_risk_budget_pusd"`,
    );
    await queryRunner.query(
      `ALTER TABLE "copy_config" RENAME COLUMN "sim_max_exposure_usdc" TO "sim_max_exposure_pusd"`,
    );
    await queryRunner.query(
      `ALTER TABLE "copy_config" RENAME COLUMN "real_max_exposure_usdc" TO "real_max_exposure_pusd"`,
    );
    await queryRunner.query(
      `ALTER TABLE "copy_config" RENAME COLUMN "sim_max_daily_loss_usdc" TO "sim_max_daily_loss_pusd"`,
    );
    await queryRunner.query(
      `ALTER TABLE "copy_config" RENAME COLUMN "real_max_daily_loss_usdc" TO "real_max_daily_loss_pusd"`,
    );
    await queryRunner.query(
      `ALTER TABLE "copy_config" RENAME COLUMN "sim_max_position_size_usdc" TO "sim_max_position_size_pusd"`,
    );
    await queryRunner.query(
      `ALTER TABLE "copy_config" RENAME COLUMN "real_max_position_size_usdc" TO "real_max_position_size_pusd"`,
    );

    // 3. crypto_config columns
    await queryRunner.query(
      `ALTER TABLE "crypto_config" RENAME COLUMN "crypto_algo_entry_usdc_amount" TO "crypto_algo_entry_pusd_amount"`,
    );
    await queryRunner.query(
      `ALTER TABLE "crypto_config" RENAME COLUMN "crypto_algo_max_exposure_usdc" TO "crypto_algo_max_exposure_pusd"`,
    );
    await queryRunner.query(
      `ALTER TABLE "crypto_config" RENAME COLUMN "crypto_algo_max_daily_loss_usdc" TO "crypto_algo_max_daily_loss_pusd"`,
    );
    await queryRunner.query(
      `ALTER TABLE "crypto_config" RENAME COLUMN "crypto_algo_max_position_size_usdc" TO "crypto_algo_max_position_size_pusd"`,
    );

    // 4. UPDATE sizing_mode values
    await queryRunner.query(
      `UPDATE "weather_config" SET "weather_algo_sizing_mode" = 'fixed_pusd' WHERE "weather_algo_sizing_mode" = 'fixed_usdc'`,
    );
    await queryRunner.query(
      `UPDATE "copy_config" SET "sim_sizing_mode" = 'fixed_pusd' WHERE "sim_sizing_mode" = 'fixed_usdc'`,
    );
    await queryRunner.query(
      `UPDATE "copy_config" SET "real_sizing_mode" = 'fixed_pusd' WHERE "real_sizing_mode" = 'fixed_usdc'`,
    );
    await queryRunner.query(
      `UPDATE "crypto_config" SET "crypto_algo_sizing_mode" = 'fixed_pusd' WHERE "crypto_algo_sizing_mode" = 'fixed_usdc'`,
    );

    // 5. ALTER sizing_mode defaults
    await queryRunner.query(
      `ALTER TABLE "weather_config" ALTER COLUMN "weather_algo_sizing_mode" SET DEFAULT 'fixed_pusd'`,
    );
    await queryRunner.query(
      `ALTER TABLE "copy_config" ALTER COLUMN "sim_sizing_mode" SET DEFAULT 'fixed_pusd'`,
    );
    await queryRunner.query(
      `ALTER TABLE "copy_config" ALTER COLUMN "real_sizing_mode" SET DEFAULT 'fixed_pusd'`,
    );
    await queryRunner.query(
      `ALTER TABLE "crypto_config" ALTER COLUMN "crypto_algo_sizing_mode" SET DEFAULT 'fixed_pusd'`,
    );

    // 6. Migrate weather strategy JSON bag keys in the 3 params columns.
    //    Each column is a JSON object `{ strategyId: { ...bag } }` stored as text.
    //    jsonb_each yields (key, value) — alias them or the UPDATE fails
    //    (`column "strategy_id" does not exist`).
    //
    //    COALESCE keeps already-renamed `*Pusd` keys (0107/0108 now write those
    //    on a fresh migrate). Blind `jsonb_build_object('entryPusd', value->'entryUsdc')`
    //    would overwrite them with JSON null when the old key is absent.
    //    Also rewrite bag `sizingMode: 'fixed_usdc'` → `'fixed_pusd'` (the
    //    column default is still `fixed_usdc` when 0107/0108 copy it into the bag).
    await this.rewriteWeatherStrategyBags(queryRunner, 'toPusd');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Reverse JSON bag keys.
    await this.rewriteWeatherStrategyBags(queryRunner, 'toUsdc');

    // Reverse sizing_mode defaults.
    await queryRunner.query(
      `ALTER TABLE "crypto_config" ALTER COLUMN "crypto_algo_sizing_mode" SET DEFAULT 'fixed_usdc'`,
    );
    await queryRunner.query(
      `ALTER TABLE "copy_config" ALTER COLUMN "real_sizing_mode" SET DEFAULT 'fixed_usdc'`,
    );
    await queryRunner.query(
      `ALTER TABLE "copy_config" ALTER COLUMN "sim_sizing_mode" SET DEFAULT 'fixed_usdc'`,
    );
    await queryRunner.query(
      `ALTER TABLE "weather_config" ALTER COLUMN "weather_algo_sizing_mode" SET DEFAULT 'fixed_usdc'`,
    );

    // Reverse sizing_mode values.
    await queryRunner.query(
      `UPDATE "crypto_config" SET "crypto_algo_sizing_mode" = 'fixed_usdc' WHERE "crypto_algo_sizing_mode" = 'fixed_pusd'`,
    );
    await queryRunner.query(
      `UPDATE "copy_config" SET "real_sizing_mode" = 'fixed_usdc' WHERE "real_sizing_mode" = 'fixed_pusd'`,
    );
    await queryRunner.query(
      `UPDATE "copy_config" SET "sim_sizing_mode" = 'fixed_usdc' WHERE "sim_sizing_mode" = 'fixed_pusd'`,
    );
    await queryRunner.query(
      `UPDATE "weather_config" SET "weather_algo_sizing_mode" = 'fixed_usdc' WHERE "weather_algo_sizing_mode" = 'fixed_pusd'`,
    );

    // Reverse crypto_config columns.
    await queryRunner.query(
      `ALTER TABLE "crypto_config" RENAME COLUMN "crypto_algo_max_position_size_pusd" TO "crypto_algo_max_position_size_usdc"`,
    );
    await queryRunner.query(
      `ALTER TABLE "crypto_config" RENAME COLUMN "crypto_algo_max_daily_loss_pusd" TO "crypto_algo_max_daily_loss_usdc"`,
    );
    await queryRunner.query(
      `ALTER TABLE "crypto_config" RENAME COLUMN "crypto_algo_max_exposure_pusd" TO "crypto_algo_max_exposure_usdc"`,
    );
    await queryRunner.query(
      `ALTER TABLE "crypto_config" RENAME COLUMN "crypto_algo_entry_pusd_amount" TO "crypto_algo_entry_usdc_amount"`,
    );

    // Reverse copy_config columns.
    await queryRunner.query(
      `ALTER TABLE "copy_config" RENAME COLUMN "real_max_position_size_pusd" TO "real_max_position_size_usdc"`,
    );
    await queryRunner.query(
      `ALTER TABLE "copy_config" RENAME COLUMN "sim_max_position_size_pusd" TO "sim_max_position_size_usdc"`,
    );
    await queryRunner.query(
      `ALTER TABLE "copy_config" RENAME COLUMN "real_max_daily_loss_pusd" TO "real_max_daily_loss_usdc"`,
    );
    await queryRunner.query(
      `ALTER TABLE "copy_config" RENAME COLUMN "sim_max_daily_loss_pusd" TO "sim_max_daily_loss_usdc"`,
    );
    await queryRunner.query(
      `ALTER TABLE "copy_config" RENAME COLUMN "real_max_exposure_pusd" TO "real_max_exposure_usdc"`,
    );
    await queryRunner.query(
      `ALTER TABLE "copy_config" RENAME COLUMN "sim_max_exposure_pusd" TO "sim_max_exposure_usdc"`,
    );
    await queryRunner.query(
      `ALTER TABLE "copy_config" RENAME COLUMN "real_risk_budget_pusd" TO "real_risk_budget_usdc"`,
    );
    await queryRunner.query(
      `ALTER TABLE "copy_config" RENAME COLUMN "sim_risk_budget_pusd" TO "sim_risk_budget_usdc"`,
    );
    await queryRunner.query(
      `ALTER TABLE "copy_config" RENAME COLUMN "real_entry_pusd_amount" TO "real_entry_usdc_amount"`,
    );
    await queryRunner.query(
      `ALTER TABLE "copy_config" RENAME COLUMN "sim_entry_pusd_amount" TO "sim_entry_usdc_amount"`,
    );

    // Reverse weather_config columns.
    await queryRunner.query(
      `ALTER TABLE "weather_config" RENAME COLUMN "weather_algo_max_position_size_pusd" TO "weather_algo_max_position_size_usdc"`,
    );
    await queryRunner.query(
      `ALTER TABLE "weather_config" RENAME COLUMN "weather_algo_max_daily_loss_pusd" TO "weather_algo_max_daily_loss_usdc"`,
    );
    await queryRunner.query(
      `ALTER TABLE "weather_config" RENAME COLUMN "weather_algo_max_exposure_pusd" TO "weather_algo_max_exposure_usdc"`,
    );
    await queryRunner.query(
      `ALTER TABLE "weather_config" RENAME COLUMN "weather_algo_entry_pusd" TO "weather_algo_entry_usdc"`,
    );
  }

  /**
   * Rewrite per-strategy JSON bags in the 3 weather params columns.
   * `jsonb_each` columns are aliased `(strategy_id, value)` — without the alias
   * Postgres raises `column "strategy_id" does not exist` and the whole
   * migration rolls back after the column renames would otherwise have applied.
   */
  private async rewriteWeatherStrategyBags(
    queryRunner: QueryRunner,
    direction: 'toPusd' | 'toUsdc',
  ): Promise<void> {
    const dropExpr =
      direction === 'toPusd'
        ? `bags.value - 'entryUsdc' - 'maxExposureUsdc' - 'maxDailyLossUsdc' - 'maxPositionSizeUsdc'`
        : `bags.value - 'entryPusd' - 'maxExposurePusd' - 'maxDailyLossPusd' - 'maxPositionSizePusd'`;
    const build =
      direction === 'toPusd'
        ? `
          'entryPusd', COALESCE(bags.value->'entryPusd', bags.value->'entryUsdc'),
          'maxExposurePusd', COALESCE(bags.value->'maxExposurePusd', bags.value->'maxExposureUsdc'),
          'maxDailyLossPusd', COALESCE(bags.value->'maxDailyLossPusd', bags.value->'maxDailyLossUsdc'),
          'maxPositionSizePusd', COALESCE(bags.value->'maxPositionSizePusd', bags.value->'maxPositionSizeUsdc')
        `
        : `
          'entryUsdc', COALESCE(bags.value->'entryUsdc', bags.value->'entryPusd'),
          'maxExposureUsdc', COALESCE(bags.value->'maxExposureUsdc', bags.value->'maxExposurePusd'),
          'maxDailyLossUsdc', COALESCE(bags.value->'maxDailyLossUsdc', bags.value->'maxDailyLossPusd'),
          'maxPositionSizeUsdc', COALESCE(bags.value->'maxPositionSizeUsdc', bags.value->'maxPositionSizePusd')
        `;
    const fromMode = direction === 'toPusd' ? 'fixed_usdc' : 'fixed_pusd';
    const toMode = direction === 'toPusd' ? 'fixed_pusd' : 'fixed_usdc';

    for (const col of [
      'weather_algo_strategy_params',
      'sim_weather_algo_strategy_params',
      'real_weather_algo_strategy_params',
    ]) {
      await queryRunner.query(`
        UPDATE "weather_config"
        SET "${col}" = COALESCE((
          SELECT jsonb_object_agg(
            bags.strategy_id,
            (
              (${dropExpr})
              || jsonb_strip_nulls(jsonb_build_object(${build}))
              || CASE
                   WHEN bags.value->>'sizingMode' = '${fromMode}'
                   THEN jsonb_build_object('sizingMode', '${toMode}')
                   ELSE '{}'::jsonb
                 END
            )
          )
          FROM jsonb_each(
            COALESCE(NULLIF("${col}", ''), '{}')::jsonb
          ) AS bags(strategy_id, value)
        ), '{}'::jsonb)::text
        WHERE "${col}" IS NOT NULL AND TRIM("${col}") <> ''
      `);
    }
  }
}
