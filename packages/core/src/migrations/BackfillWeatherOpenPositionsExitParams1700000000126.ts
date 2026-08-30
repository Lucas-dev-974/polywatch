import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Backfill SL/TP/Trailing on open WEATHER_OPEN positions that were opened
 * while the corresponding strategy leg was disabled.
 *
 * When a position is opened, its sl_percent/tp_percent/trailing_percent/
 * trailing_activation_percent are resolved from the strategy config at that
 * moment. If a leg was disabled (e.g. slEnabled=false), the column stays NULL.
 *
 * If the user later enables the leg in the UI, new positions get the threshold
 * but existing positions keep NULL → the PositionExitEvaluator never checks
 * that leg for them (reads pos.slPercent === null).
 *
 * 0124 already ran once and will not re-apply to positions opened afterwards.
 * This follow-up re-applies the same OPEN-only backfill (idempotent COALESCE)
 * so today's real WEATHER_* rows missing percents pick up the current bag.
 * Closed rows are left untouched — do not rewrite historical PnL / disabled legs.
 *
 * Resolution mirrors `resolveWeatherEntryExitParams` in
 * packages/core/src/risk/weather-exit-params.ts (catalogue flag defaults
 * sl/tp/trailingEnabled=true; percent 0/null → WEATHER_EXIT_DEFAULTS).
 */
export class BackfillWeatherOpenPositionsExitParams1700000000126 implements MigrationInterface {
  name = 'BackfillWeatherOpenPositionsExitParams1700000000126';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const configRows = await queryRunner.query(
      `SELECT
         weather_algo_strategy_params,
         sim_weather_algo_strategy_params,
         real_weather_algo_strategy_params
       FROM weather_config
       WHERE id = 1`,
    );

    if (configRows.length === 0) {
      return;
    }

    const config = configRows[0];

    const parseParams = (raw: string | null | undefined): Record<string, Record<string, unknown>> => {
      if (!raw || raw === '') return {};
      try {
        const parsed = JSON.parse(raw) as unknown;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
        const out: Record<string, Record<string, unknown>> = {};
        for (const [key, bag] of Object.entries(parsed as Record<string, unknown>)) {
          if (bag && typeof bag === 'object' && !Array.isArray(bag)) {
            out[key] = bag as Record<string, unknown>;
          }
        }
        return out;
      } catch {
        return {};
      }
    };

    const pickMap = (
      perMode: Record<string, Record<string, unknown>>,
      global: Record<string, Record<string, unknown>>,
    ): Record<string, Record<string, unknown>> =>
      Object.keys(perMode).length > 0 ? perMode : global;

    const globalParams = parseParams(config.weather_algo_strategy_params);
    const simParams = pickMap(parseParams(config.sim_weather_algo_strategy_params), globalParams);
    const realParams = pickMap(parseParams(config.real_weather_algo_strategy_params), globalParams);

    // Matches WEATHER_EXIT_DEFAULTS in weather-exit-params.ts.
    const EXIT_DEFAULTS = {
      sl: 20,
      tp: 25,
      trailing: 10,
      trailingActivation: 12,
    } as const;

    /**
     * Catalogue default for sl/tp/trailingEnabled is `true`. A missing flag
     * therefore enables the leg (same as getStrategyParams overlay). Explicit
     * `false` keeps NULL. Percent 0/null falls back to WEATHER_EXIT_DEFAULTS.
     */
    function resolvePercent(
      bag: Record<string, unknown>,
      enabledKey: string,
      percentKey: string,
      fallback: number,
    ): number | null {
      if (bag[enabledKey] === false) return null;
      const val = bag[percentKey];
      if (typeof val === 'number' && Number.isFinite(val) && val > 0) return val;
      return fallback;
    }

    function resolveBag(bag: Record<string, unknown> | undefined): {
      sl: number | null;
      tp: number | null;
      trailing: number | null;
      trailingActivation: number | null;
    } {
      const b = bag ?? {};
      const trailing = resolvePercent(b, 'trailingEnabled', 'trailingPercent', EXIT_DEFAULTS.trailing);
      return {
        sl: resolvePercent(b, 'slEnabled', 'slPercent', EXIT_DEFAULTS.sl),
        tp: resolvePercent(b, 'tpEnabled', 'tpPercent', EXIT_DEFAULTS.tp),
        trailing,
        trailingActivation:
          trailing == null
            ? null
            : resolvePercent(
                b,
                'trailingEnabled',
                'trailingActivationPercent',
                EXIT_DEFAULTS.trailingActivation,
              ),
      };
    }

    const resolvedCache = new Map<
      string,
      { sl: number | null; tp: number | null; trailing: number | null; trailingActivation: number | null }
    >();

    const strategyIds = new Set<string>([
      'weather-forecast',
      ...Object.keys(simParams),
      ...Object.keys(realParams),
      ...Object.keys(globalParams),
    ]);

    for (const strategyId of strategyIds) {
      resolvedCache.set(`${strategyId}|sim`, resolveBag(simParams[strategyId] ?? globalParams[strategyId]));
      resolvedCache.set(`${strategyId}|real`, resolveBag(realParams[strategyId] ?? globalParams[strategyId]));
    }

    const positions = await queryRunner.query(`
      SELECT id, strategy_id, mode
      FROM copied_positions
      WHERE reason LIKE 'WEATHER_%'
        AND status = 'open'
        AND quantity > 0
        AND (
          sl_percent IS NULL
          OR tp_percent IS NULL
          OR trailing_percent IS NULL
          OR trailing_activation_percent IS NULL
        )
    `);

    if (positions.length === 0) {
      return;
    }

    for (const pos of positions) {
      const strategyId = pos.strategy_id ?? 'weather-forecast';
      const mode = pos.mode === 'real' ? 'real' : 'sim';
      const resolved = resolvedCache.get(`${strategyId}|${mode}`) ?? resolveBag(undefined);

      // COALESCE keeps any already-set column; NULL params leave the column unchanged.
      await queryRunner.query(
        `UPDATE copied_positions SET
           sl_percent = COALESCE(sl_percent, $2),
           tp_percent = COALESCE(tp_percent, $3),
           trailing_percent = COALESCE(trailing_percent, $4),
           trailing_activation_percent = COALESCE(trailing_activation_percent, $5)
         WHERE id = $1`,
        [pos.id, resolved.sl, resolved.tp, resolved.trailing, resolved.trailingActivation],
      );
    }
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // Non-reversible: we don't know the original NULL state per position.
  }
}