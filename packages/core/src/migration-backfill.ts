import type { DataSource, QueryRunner } from 'typeorm';
import { migrations } from './database/data-source.js';

/**
 * Helpers to introspect a PostgreSQL schema without relying on TypeORM's
 * QueryRunner.hasTable/hasColumn/hasIndex, which are not consistently available
 * across driver versions.
 */

async function tableExists(qr: QueryRunner, table: string): Promise<boolean> {
  const rows = await qr.query(
    `SELECT 1 FROM information_schema.tables WHERE table_name = $1 LIMIT 1`,
    [table],
  ) as Array<unknown>;
  return rows.length > 0;
}

async function columnExists(qr: QueryRunner, table: string, column: string): Promise<boolean> {
  const rows = await qr.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_name = $1 AND column_name = $2
     LIMIT 1`,
    [table, column],
  ) as Array<unknown>;
  return rows.length > 0;
}

async function indexExists(qr: QueryRunner, indexName: string): Promise<boolean> {
  const rows = await qr.query(
    `SELECT 1 FROM pg_indexes WHERE indexname = $1 LIMIT 1`,
    [indexName],
  ) as Array<unknown>;
  return rows.length > 0;
}

/**
 * Extract the trailing timestamp from a TypeORM migration class name
 * (e.g. `Baseline1700000000000` -> 1700000000000).
 */
function migrationTimestamp(name: string): number {
  return Number(name.match(/(\d+)$/)?.[1] ?? Date.now());
}

/**
 * For each known migration, a probe that returns true when the migration's
 * effects are already present in the database. Used to backfill the
 * `migrations` tracking table on databases originally created via
 * `synchronize: true` (where migrations were never recorded).
 */
const migrationEffects: Record<string, (qr: QueryRunner) => Promise<boolean>> = {
  Baseline1700000000000: async (qr) => tableExists(qr, 'risk_config'),
  AddSnapshotIndexes1700000000001: async (qr) => indexExists(qr, 'idx_sim_snapshots_created'),
  AddSnapshotRetentionColumns1700000000002: async (qr) =>
    columnExists(qr, 'risk_config', 'sim_snapshot_max_count'),
  AddCopyIncreaseSlProximity1700000000003: async (qr) =>
    columnExists(qr, 'risk_config', 'sim_copy_increase_sl_proximity_enabled'),
  CreateAlgoMarketSelections1700000000004: async (qr) => tableExists(qr, 'algo_market_selection'),
  AddReasonToCopiedPositions1700000000005: async (qr) =>
    columnExists(qr, 'copied_position', 'reason'),
  AddCryptoAlgoRiskConfig1700000000006: async (qr) =>
    columnExists(qr, 'risk_config', 'crypto_algo_enabled'),
  AddRealCashOverride1700000000007: async (qr) =>
    columnExists(qr, 'risk_config', 'real_cash_override'),
  CreateAlgoSurveillanceSnapshots1700000000009: async (qr) =>
    tableExists(qr, 'algo_surveillance_snapshots'),
  AddSlConfirmationTicksRiskConfig1700000000033: async (qr) =>
    columnExists(qr, 'risk_config', 'sl_confirmation_ticks'),
  SplitSlTpEnabledFlags1700000000042: async (qr) =>
    (await columnExists(qr, 'risk_config', 'sim_sl_enabled')) &&
    (await columnExists(qr, 'risk_config', 'crypto_algo_sl_enabled')) &&
    !(await columnExists(qr, 'risk_config', 'sim_sl_tp_enabled')),
};

/**
 * Ensure the TypeORM `migrations` tracking table exists. It would normally be
 * created by `DataSource.initialize()` when `migrationsRun` is true, but the
 * migrator DataSource disables auto-run to allow backfilling first.
 */
async function ensureMigrationsTable(qr: QueryRunner): Promise<void> {
  if (await tableExists(qr, 'migrations')) {
    return;
  }
  await qr.query(`
    CREATE TABLE IF NOT EXISTS "migrations" (
      "id" SERIAL PRIMARY KEY,
      "timestamp" bigint NOT NULL,
      "name" varchar NOT NULL
    )
  `);
}

/**
 * On databases originally created via `synchronize: true`, TypeORM's
 * `migrations` table is empty, so `runMigrations()` would try to re-run every
 * migration from scratch. This function detects that situation (core tables
 * exist but no migrations are recorded) and backfills the tracking table for
 * migrations whose effects are already present, so only genuinely missing
 * migrations run.
 */
export async function backfillAppliedMigrations(ds: DataSource): Promise<void> {
  const qr = ds.createQueryRunner();
  try {
    await ensureMigrationsTable(qr);

    const applied = await qr.query(`SELECT name FROM "migrations"`) as Array<{ name: string }>;
    if (applied.length > 0) {
      return;
    }

    // Only backfill on an already-synchronized database.
    if (!(await tableExists(qr, 'risk_config'))) {
      return;
    }

    let backfilled = 0;
    for (const migration of migrations) {
      const effectPresent = migrationEffects[migration.name];
      if (!effectPresent || !(await effectPresent(qr))) {
        continue;
      }
      await qr.query(
        `INSERT INTO "migrations" ("timestamp", "name") VALUES ($1, $2)`,
        [migrationTimestamp(migration.name), migration.name],
      );
      backfilled += 1;
    }
    if (backfilled > 0) {
      console.log(
        `Backfilled ${backfilled} migration record(s) (already-synchronized database).`,
      );
    }
  } finally {
    await qr.release();
  }
}