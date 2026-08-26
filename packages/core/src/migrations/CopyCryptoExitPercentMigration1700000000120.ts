import { MigrationInterface, QueryRunner } from 'typeorm';

const COPY_PERCENT_DEFAULTS = {
  sl: 20,
  tp: 25,
  trailing: 10,
  trailingActivation: 12,
} as const;

const BID_TO_PERCENT_KEYS = [
  ['slBidPoints', 'slPercent'],
  ['tpBidPoints', 'tpPercent'],
  ['trailingBidPoints', 'trailingPercent'],
  ['trailingActivationBidPoints', 'trailingActivationPercent'],
] as const;

/**
 * Postgres `ROUND(float, int)` does not exist — cast to numeric first.
 * SQLite accepts the same CAST form.
 */
function roundToPercent(expr: string): string {
  return `ROUND((${expr})::numeric, 4)`;
}

function convertExitDefaultsJson(raw: string | null): string | null {
  if (raw == null || raw.trim() === '') return raw;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return raw;
    }
    let changed = false;
    const out: Record<string, unknown> = {};
    for (const [interval, entry] of Object.entries(
      parsed as Record<string, unknown>,
    )) {
      if (entry == null || typeof entry !== 'object' || Array.isArray(entry)) {
        out[interval] = entry;
        continue;
      }
      const next: Record<string, unknown> = { ...(entry as Record<string, unknown>) };
      for (const [oldKey, newKey] of BID_TO_PERCENT_KEYS) {
        const existing = next[newKey];
        const legacy = next[oldKey];
        if (
          (existing == null || existing === '') &&
          typeof legacy === 'number' &&
          Number.isFinite(legacy) &&
          legacy > 0
        ) {
          next[newKey] = Math.round(legacy * 100 * 10_000) / 10_000;
          changed = true;
        }
        if (oldKey in next) {
          delete next[oldKey];
          changed = true;
        }
      }
      out[interval] = next;
    }
    return changed ? JSON.stringify(out) : raw;
  } catch {
    return raw;
  }
}

/**
 * Converts copy-trading and crypto-algo exit thresholds from bid points
 * (absolute probability distance on [0,1]) to percentage of invested amount,
 * matching the weather-algo model.
 *
 * Steps:
 *  1. Add `*_percent` columns to `copy_config` (with weather-matching defaults)
 *     and nullable `*_percent` columns to `crypto_config`.
 *  2. Backfill crypto config overrides: `percent = bidPoints * 100`.
 *  3. Backfill open positions that still have bid points and no percent:
 *     `slPercent = slBidPoints / entryBidVwap * 100`.
 *  4. Rewrite `crypto_algo_exit_defaults_by_interval` JSON keys.
 *  5. Drop the obsolete `*_bid_points` columns.
 */
export class CopyCryptoExitToPercent1700000000120 implements MigrationInterface {
  name = 'CopyCryptoExitToPercent1700000000120';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── copy_config percent columns (non-null defaults = weather convention) ─
    await queryRunner.query(
      `ALTER TABLE "copy_config" ADD COLUMN IF NOT EXISTS "sim_sl_percent" REAL DEFAULT ${COPY_PERCENT_DEFAULTS.sl}`,
    );
    await queryRunner.query(
      `ALTER TABLE "copy_config" ADD COLUMN IF NOT EXISTS "sim_tp_percent" REAL DEFAULT ${COPY_PERCENT_DEFAULTS.tp}`,
    );
    await queryRunner.query(
      `ALTER TABLE "copy_config" ADD COLUMN IF NOT EXISTS "sim_trailing_percent" REAL DEFAULT ${COPY_PERCENT_DEFAULTS.trailing}`,
    );
    await queryRunner.query(
      `ALTER TABLE "copy_config" ADD COLUMN IF NOT EXISTS "sim_trailing_activation_percent" REAL DEFAULT ${COPY_PERCENT_DEFAULTS.trailingActivation}`,
    );
    await queryRunner.query(
      `ALTER TABLE "copy_config" ADD COLUMN IF NOT EXISTS "real_sl_percent" REAL DEFAULT ${COPY_PERCENT_DEFAULTS.sl}`,
    );
    await queryRunner.query(
      `ALTER TABLE "copy_config" ADD COLUMN IF NOT EXISTS "real_tp_percent" REAL DEFAULT ${COPY_PERCENT_DEFAULTS.tp}`,
    );
    await queryRunner.query(
      `ALTER TABLE "copy_config" ADD COLUMN IF NOT EXISTS "real_trailing_percent" REAL DEFAULT ${COPY_PERCENT_DEFAULTS.trailing}`,
    );
    await queryRunner.query(
      `ALTER TABLE "copy_config" ADD COLUMN IF NOT EXISTS "real_trailing_activation_percent" REAL DEFAULT ${COPY_PERCENT_DEFAULTS.trailingActivation}`,
    );

    // Fill NULLs if the columns already existed without a default.
    await queryRunner.query(
      `UPDATE "copy_config" SET
         "sim_sl_percent" = COALESCE("sim_sl_percent", ${COPY_PERCENT_DEFAULTS.sl}),
         "sim_tp_percent" = COALESCE("sim_tp_percent", ${COPY_PERCENT_DEFAULTS.tp}),
         "sim_trailing_percent" = COALESCE("sim_trailing_percent", ${COPY_PERCENT_DEFAULTS.trailing}),
         "sim_trailing_activation_percent" = COALESCE("sim_trailing_activation_percent", ${COPY_PERCENT_DEFAULTS.trailingActivation}),
         "real_sl_percent" = COALESCE("real_sl_percent", ${COPY_PERCENT_DEFAULTS.sl}),
         "real_tp_percent" = COALESCE("real_tp_percent", ${COPY_PERCENT_DEFAULTS.tp}),
         "real_trailing_percent" = COALESCE("real_trailing_percent", ${COPY_PERCENT_DEFAULTS.trailing}),
         "real_trailing_activation_percent" = COALESCE("real_trailing_activation_percent", ${COPY_PERCENT_DEFAULTS.trailingActivation})`,
    );

    // ── crypto_config percent columns (nullable = interval-table fallback) ─
    await queryRunner.query(
      `ALTER TABLE "crypto_config" ADD COLUMN IF NOT EXISTS "crypto_algo_sl_percent" REAL`,
    );
    await queryRunner.query(
      `ALTER TABLE "crypto_config" ADD COLUMN IF NOT EXISTS "crypto_algo_tp_percent" REAL`,
    );
    await queryRunner.query(
      `ALTER TABLE "crypto_config" ADD COLUMN IF NOT EXISTS "crypto_algo_trailing_percent" REAL`,
    );
    await queryRunner.query(
      `ALTER TABLE "crypto_config" ADD COLUMN IF NOT EXISTS "crypto_algo_trailing_activation_percent" REAL`,
    );

    // Preserve explicit crypto overrides: 0.10 bid points → 10% of stake.
    await queryRunner.query(
      `UPDATE "crypto_config"
       SET "crypto_algo_sl_percent" = ${roundToPercent('"crypto_algo_sl_bid_points" * 100')}
       WHERE "crypto_algo_sl_bid_points" IS NOT NULL AND "crypto_algo_sl_percent" IS NULL`,
    );
    await queryRunner.query(
      `UPDATE "crypto_config"
       SET "crypto_algo_tp_percent" = ${roundToPercent('"crypto_algo_tp_bid_points" * 100')}
       WHERE "crypto_algo_tp_bid_points" IS NOT NULL AND "crypto_algo_tp_percent" IS NULL`,
    );
    await queryRunner.query(
      `UPDATE "crypto_config"
       SET "crypto_algo_trailing_percent" = ${roundToPercent('"crypto_algo_trailing_bid_points" * 100')}
       WHERE "crypto_algo_trailing_bid_points" IS NOT NULL AND "crypto_algo_trailing_percent" IS NULL`,
    );
    await queryRunner.query(
      `UPDATE "crypto_config"
       SET "crypto_algo_trailing_activation_percent" = ${roundToPercent('"crypto_algo_trailing_activation_bid_points" * 100')}
       WHERE "crypto_algo_trailing_activation_bid_points" IS NOT NULL AND "crypto_algo_trailing_activation_percent" IS NULL`,
    );

    // ── Positions: only fill percent when still empty (do not overwrite weather) ─
    await queryRunner.query(
      `UPDATE "copied_positions"
       SET "sl_percent" = ${roundToPercent('("sl_bid_points" / "entry_bid_vwap") * 100')}
       WHERE "sl_bid_points" IS NOT NULL AND "entry_bid_vwap" > 0 AND "sl_percent" IS NULL`,
    );
    await queryRunner.query(
      `UPDATE "copied_positions"
       SET "tp_percent" = ${roundToPercent('("tp_bid_points" / "entry_bid_vwap") * 100')}
       WHERE "tp_bid_points" IS NOT NULL AND "entry_bid_vwap" > 0 AND "tp_percent" IS NULL`,
    );
    await queryRunner.query(
      `UPDATE "copied_positions"
       SET "trailing_percent" = ${roundToPercent('("trailing_bid_points" / "entry_bid_vwap") * 100')}
       WHERE "trailing_bid_points" IS NOT NULL AND "entry_bid_vwap" > 0 AND "trailing_percent" IS NULL`,
    );
    await queryRunner.query(
      `UPDATE "copied_positions"
       SET "trailing_activation_percent" = ${roundToPercent('("trailing_activation_bid_points" / "entry_bid_vwap") * 100')}
       WHERE "trailing_activation_bid_points" IS NOT NULL AND "entry_bid_vwap" > 0 AND "trailing_activation_percent" IS NULL`,
    );

    // ── Rewrite crypto interval-exit JSON (legacy *BidPoints keys) ────────
    const rows: Array<{
      id: number;
      crypto_algo_exit_defaults_by_interval: string | null;
    }> = await queryRunner.query(
      `SELECT id, crypto_algo_exit_defaults_by_interval FROM crypto_config`,
    );
    for (const row of rows) {
      const converted = convertExitDefaultsJson(
        row.crypto_algo_exit_defaults_by_interval,
      );
      if (converted !== row.crypto_algo_exit_defaults_by_interval) {
        const escaped =
          converted == null
            ? 'NULL'
            : `'${converted.replace(/'/g, "''")}'`;
        await queryRunner.query(
          `UPDATE "crypto_config"
           SET "crypto_algo_exit_defaults_by_interval" = ${escaped}
           WHERE id = ${Number(row.id)}`,
        );
      }
    }

    // ── Drop copy_config bid points ───────────────────────────────────
    await queryRunner.query(
      `ALTER TABLE "copy_config" DROP COLUMN IF EXISTS "sim_sl_bid_points"`,
    );
    await queryRunner.query(
      `ALTER TABLE "copy_config" DROP COLUMN IF EXISTS "sim_tp_bid_points"`,
    );
    await queryRunner.query(
      `ALTER TABLE "copy_config" DROP COLUMN IF EXISTS "sim_trailing_bid_points"`,
    );
    await queryRunner.query(
      `ALTER TABLE "copy_config" DROP COLUMN IF EXISTS "sim_trailing_activation_bid_points"`,
    );
    await queryRunner.query(
      `ALTER TABLE "copy_config" DROP COLUMN IF EXISTS "real_sl_bid_points"`,
    );
    await queryRunner.query(
      `ALTER TABLE "copy_config" DROP COLUMN IF EXISTS "real_tp_bid_points"`,
    );
    await queryRunner.query(
      `ALTER TABLE "copy_config" DROP COLUMN IF EXISTS "real_trailing_bid_points"`,
    );
    await queryRunner.query(
      `ALTER TABLE "copy_config" DROP COLUMN IF EXISTS "real_trailing_activation_bid_points"`,
    );

    // ── Drop crypto_config bid points ─────────────────────────────────
    await queryRunner.query(
      `ALTER TABLE "crypto_config" DROP COLUMN IF EXISTS "crypto_algo_sl_bid_points"`,
    );
    await queryRunner.query(
      `ALTER TABLE "crypto_config" DROP COLUMN IF EXISTS "crypto_algo_tp_bid_points"`,
    );
    await queryRunner.query(
      `ALTER TABLE "crypto_config" DROP COLUMN IF EXISTS "crypto_algo_trailing_bid_points"`,
    );
    await queryRunner.query(
      `ALTER TABLE "crypto_config" DROP COLUMN IF EXISTS "crypto_algo_trailing_activation_bid_points"`,
    );

    // ── Drop copied_positions bid points ──────────────────────────────
    await queryRunner.query(
      `ALTER TABLE "copied_positions" DROP COLUMN IF EXISTS "sl_bid_points"`,
    );
    await queryRunner.query(
      `ALTER TABLE "copied_positions" DROP COLUMN IF EXISTS "tp_bid_points"`,
    );
    await queryRunner.query(
      `ALTER TABLE "copied_positions" DROP COLUMN IF EXISTS "trailing_bid_points"`,
    );
    await queryRunner.query(
      `ALTER TABLE "copied_positions" DROP COLUMN IF EXISTS "trailing_activation_bid_points"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "copy_config" ADD COLUMN IF NOT EXISTS "sim_sl_bid_points" REAL`,
    );
    await queryRunner.query(
      `ALTER TABLE "copy_config" ADD COLUMN IF NOT EXISTS "sim_tp_bid_points" REAL`,
    );
    await queryRunner.query(
      `ALTER TABLE "copy_config" ADD COLUMN IF NOT EXISTS "sim_trailing_bid_points" REAL`,
    );
    await queryRunner.query(
      `ALTER TABLE "copy_config" ADD COLUMN IF NOT EXISTS "sim_trailing_activation_bid_points" REAL`,
    );
    await queryRunner.query(
      `ALTER TABLE "copy_config" ADD COLUMN IF NOT EXISTS "real_sl_bid_points" REAL`,
    );
    await queryRunner.query(
      `ALTER TABLE "copy_config" ADD COLUMN IF NOT EXISTS "real_tp_bid_points" REAL`,
    );
    await queryRunner.query(
      `ALTER TABLE "copy_config" ADD COLUMN IF NOT EXISTS "real_trailing_bid_points" REAL`,
    );
    await queryRunner.query(
      `ALTER TABLE "copy_config" ADD COLUMN IF NOT EXISTS "real_trailing_activation_bid_points" REAL`,
    );

    await queryRunner.query(
      `ALTER TABLE "crypto_config" ADD COLUMN IF NOT EXISTS "crypto_algo_sl_bid_points" REAL`,
    );
    await queryRunner.query(
      `ALTER TABLE "crypto_config" ADD COLUMN IF NOT EXISTS "crypto_algo_tp_bid_points" REAL`,
    );
    await queryRunner.query(
      `ALTER TABLE "crypto_config" ADD COLUMN IF NOT EXISTS "crypto_algo_trailing_bid_points" REAL`,
    );
    await queryRunner.query(
      `ALTER TABLE "crypto_config" ADD COLUMN IF NOT EXISTS "crypto_algo_trailing_activation_bid_points" REAL`,
    );

    await queryRunner.query(
      `ALTER TABLE "copied_positions" ADD COLUMN IF NOT EXISTS "sl_bid_points" REAL`,
    );
    await queryRunner.query(
      `ALTER TABLE "copied_positions" ADD COLUMN IF NOT EXISTS "tp_bid_points" REAL`,
    );
    await queryRunner.query(
      `ALTER TABLE "copied_positions" ADD COLUMN IF NOT EXISTS "trailing_bid_points" REAL`,
    );
    await queryRunner.query(
      `ALTER TABLE "copied_positions" ADD COLUMN IF NOT EXISTS "trailing_activation_bid_points" REAL`,
    );

    await queryRunner.query(
      `UPDATE "copied_positions"
       SET "sl_bid_points" = ("sl_percent" / 100) * "entry_bid_vwap"
       WHERE "sl_percent" IS NOT NULL AND "entry_bid_vwap" > 0`,
    );
    await queryRunner.query(
      `UPDATE "copied_positions"
       SET "tp_bid_points" = ("tp_percent" / 100) * "entry_bid_vwap"
       WHERE "tp_percent" IS NOT NULL AND "entry_bid_vwap" > 0`,
    );
    await queryRunner.query(
      `UPDATE "copied_positions"
       SET "trailing_bid_points" = ("trailing_percent" / 100) * "entry_bid_vwap"
       WHERE "trailing_percent" IS NOT NULL AND "entry_bid_vwap" > 0`,
    );
    await queryRunner.query(
      `UPDATE "copied_positions"
       SET "trailing_activation_bid_points" = ("trailing_activation_percent" / 100) * "entry_bid_vwap"
       WHERE "trailing_activation_percent" IS NOT NULL AND "entry_bid_vwap" > 0`,
    );

    await queryRunner.query(
      `UPDATE "crypto_config"
       SET "crypto_algo_sl_bid_points" = "crypto_algo_sl_percent" / 100
       WHERE "crypto_algo_sl_percent" IS NOT NULL`,
    );
    await queryRunner.query(
      `UPDATE "crypto_config"
       SET "crypto_algo_tp_bid_points" = "crypto_algo_tp_percent" / 100
       WHERE "crypto_algo_tp_percent" IS NOT NULL`,
    );
    await queryRunner.query(
      `UPDATE "crypto_config"
       SET "crypto_algo_trailing_bid_points" = "crypto_algo_trailing_percent" / 100
       WHERE "crypto_algo_trailing_percent" IS NOT NULL`,
    );
    await queryRunner.query(
      `UPDATE "crypto_config"
       SET "crypto_algo_trailing_activation_bid_points" = "crypto_algo_trailing_activation_percent" / 100
       WHERE "crypto_algo_trailing_activation_percent" IS NOT NULL`,
    );

    await queryRunner.query(
      `ALTER TABLE "copy_config" DROP COLUMN IF EXISTS "sim_sl_percent"`,
    );
    await queryRunner.query(
      `ALTER TABLE "copy_config" DROP COLUMN IF EXISTS "sim_tp_percent"`,
    );
    await queryRunner.query(
      `ALTER TABLE "copy_config" DROP COLUMN IF EXISTS "sim_trailing_percent"`,
    );
    await queryRunner.query(
      `ALTER TABLE "copy_config" DROP COLUMN IF EXISTS "sim_trailing_activation_percent"`,
    );
    await queryRunner.query(
      `ALTER TABLE "copy_config" DROP COLUMN IF EXISTS "real_sl_percent"`,
    );
    await queryRunner.query(
      `ALTER TABLE "copy_config" DROP COLUMN IF EXISTS "real_tp_percent"`,
    );
    await queryRunner.query(
      `ALTER TABLE "copy_config" DROP COLUMN IF EXISTS "real_trailing_percent"`,
    );
    await queryRunner.query(
      `ALTER TABLE "copy_config" DROP COLUMN IF EXISTS "real_trailing_activation_percent"`,
    );

    await queryRunner.query(
      `ALTER TABLE "crypto_config" DROP COLUMN IF EXISTS "crypto_algo_sl_percent"`,
    );
    await queryRunner.query(
      `ALTER TABLE "crypto_config" DROP COLUMN IF EXISTS "crypto_algo_tp_percent"`,
    );
    await queryRunner.query(
      `ALTER TABLE "crypto_config" DROP COLUMN IF EXISTS "crypto_algo_trailing_percent"`,
    );
    await queryRunner.query(
      `ALTER TABLE "crypto_config" DROP COLUMN IF EXISTS "crypto_algo_trailing_activation_percent"`,
    );
  }
}
