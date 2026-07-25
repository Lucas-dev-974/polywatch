import pg from 'pg';
import { loadMonorepoEnv } from '../packages/core/src/config/env.js';

loadMonorepoEnv();

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const j = (v: unknown) => JSON.stringify(v, null, 2);

async function main() {
  const c = await pool.connect();
  try {
    const pending = await c.query(`
      SELECT id, condition_id, outcome, reason, asset_id
      FROM copied_positions WHERE mode='sim' AND status='pending'
    `);
    console.log('PENDING', j(pending.rows));

    const ids = pending.rows.map((r) => r.id);
    if (ids.length) {
      const ex = await c.query(
        `SELECT id, copied_position_id, status, error, reason, side, order_signal_id
         FROM executions WHERE copied_position_id = ANY($1)`,
        [ids],
      );
      console.log('EX FOR PENDING', j(ex.rows));
    }

    const cols = await c.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name='position_reservations' ORDER BY 1
    `);
    console.log('RESV COLS', cols.rows.map((r) => r.column_name).join(', '));

    const resv = await c.query(`SELECT * FROM position_reservations ORDER BY id DESC LIMIT 20`);
    console.log('RESV', j(resv.rows));

    const algoCfg = await c.query(`
      SELECT crypto_algo_reentry_window_ms, crypto_algo_max_entries_per_window,
             crypto_algo_min_time_to_close, crypto_algo_min_time_to_close_buffer_seconds,
             crypto_algo_base_threshold, crypto_algo_max_spread_abs,
             crypto_algo_exit_defaults_by_interval, crypto_algo_pre_close_seconds_by_interval,
             crypto_algo_time_exit_seconds_by_interval, crypto_algo_spread_abs_by_interval
      FROM risk_config WHERE id=1
    `);
    console.log('ALGO TUNABLES', j(algoCfg.rows[0]));

    // Worker logs won't be in DB — check if any order-signals related executions for ALGO today
    const todayAlgo = await c.query(`
      SELECT e.id, e.status, e.error, e.reason, e.mode, e.side, e.copied_position_id, e.executed_at,
             p.condition_id, p.outcome, p.status AS pos_status
      FROM executions e
      JOIN copied_positions p ON p.id = e.copied_position_id
      WHERE p.reason = 'ALGO_OPEN' OR e.reason = 'ALGO_OPEN'
      ORDER BY e.id DESC LIMIT 30
    `);
    console.log('ALGO EXECS', j(todayAlgo.rows));

    // Any sim executions at all historically?
    const simEx = await c.query(`SELECT COUNT(*)::int AS n FROM executions WHERE mode='sim'`);
    console.log('SIM EX COUNT', j(simEx.rows[0]));

    // Check worker placing janitor - pending age
    const pendingAge = await c.query(`
      SELECT id, condition_id, outcome,
             (SELECT MAX(id) FROM executions e WHERE e.copied_position_id = p.id) AS last_exec_id
      FROM copied_positions p
      WHERE mode='sim' AND status='pending'
    `);
    console.log('PENDING AGE LINK', j(pendingAge.rows));

  } finally {
    c.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
