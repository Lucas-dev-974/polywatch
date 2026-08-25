/**
 * Audit d'une run backtest : récupère en BDD le run, ses positions, equity,
 * excluded ticks et warnings, puis produit un rapport JSON complet.
 *
 * Usage:
 *   npx tsx tools/audit-backtest-run.ts 57
 *   npx tsx tools/audit-backtest-run.ts 57 --out tmp/run57.json
 */
import pg from 'pg';
import { loadMonorepoEnv } from '../packages/core/src/config/env.js';

loadMonorepoEnv();

const runId = Number(process.argv[2]);
if (!Number.isInteger(runId) || runId <= 0) {
  console.error('Usage: npx tsx tools/audit-backtest-run.ts <runId> [--out <file>]');
  process.exit(1);
}

const outIdx = process.argv.indexOf('--out');
const outFile = outIdx >= 0 ? process.argv[outIdx + 1] : null;

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const c = await pool.connect();
  try {
    await c.query(`SET TIME ZONE 'UTC'`);

    const runRes = await c.query(
      `SELECT id, created_at::text AS created_at, started_at::text AS started_at,
              finished_at::text AS finished_at, status, progress_pct, domain, mode,
              label, params_json, config_snapshot_json, data_range_from::text AS data_range_from,
              data_range_to::text AS data_range_to, stats_json, fidelity_warnings_json,
              user_id, engine_version, config_fingerprint, error
       FROM backtest_runs WHERE id = $1`,
      [runId],
    );
    const run = runRes.rows[0];
    if (!run) {
      console.error(`Run #${runId} introuvable.`);
      process.exit(1);
    }

    const positions = (
      await c.query(
        `SELECT id, run_id, condition_id, city, side, qty, entry_price, exit_price,
                entry_at::text AS entry_at, exit_at::text AS exit_at,
                entry_reason, exit_reason, pnl, fees, meta_json
         FROM backtest_positions WHERE run_id = $1 ORDER BY entry_at`,
        [runId],
      )
    ).rows;

    const equity = (
      await c.query(
        `SELECT t::text AS t, equity, cash, open_positions
         FROM backtest_equity_points WHERE run_id = $1 ORDER BY t`,
        [runId],
      )
    ).rows;

    const excluded = (
      await c.query(
        `SELECT t::text AS t, reason, city, condition_id, metric
         FROM backtest_excluded_ticks WHERE run_id = $1 ORDER BY t`,
        [runId],
      )
    ).rows;

    const data = {
      run,
      positions,
      equity,
      excluded,
    };

    if (outFile) {
      const fs = await import('node:fs/promises');
      await fs.writeFile(outFile, JSON.stringify(data, null, 2), 'utf8');
      console.log(`Wrote ${JSON.stringify(data).length} bytes to ${outFile}`);
    } else {
      console.log(JSON.stringify(data, null, 2));
    }
  } finally {
    c.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
