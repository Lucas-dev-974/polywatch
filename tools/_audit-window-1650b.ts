import pg from 'pg';
import { loadMonorepoEnv } from '../packages/core/src/config/env.js';

loadMonorepoEnv();
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const j = (v: unknown) => JSON.stringify(v, null, 2);

const WINDOW_START = '2026-07-11T14:50:00.000Z';
const WINDOW_END = '2026-07-11T14:55:00.000Z';

async function main() {
  const c = await pool.connect();
  try {
    const snaps = await c.query(
      `SELECT condition_id, crypto_symbol, interval, positions_json
       FROM algo_surveillance_snapshots
       WHERE market_start_at = $1 AND market_end_at = $2`,
      [WINDOW_START, WINDOW_END],
    );
    console.log('SNAPSHOTS', j(snaps.rows));

    const condIds = snaps.rows.map((r) => r.condition_id as string);

    for (const cid of condIds) {
      console.log(`\n===== ${cid} =====`);
      const pos = await c.query(
        `SELECT id, outcome, status, opened_at, asset_id
         FROM copied_positions
         WHERE condition_id = $1 AND reason = 'ALGO_OPEN'
         ORDER BY id`,
        [cid],
      );
      console.log('positions', j(pos.rows));

      const execs = await c.query(
        `SELECT e.* FROM executions e
         JOIN copied_positions p ON p.id = e.copied_position_id
         WHERE p.condition_id = $1 ORDER BY e.id`,
        [cid],
      );
      console.log('executions', j(execs.rows));

      const ticks = await c.query(
        `SELECT COUNT(*)::int AS n,
                COUNT(*) FILTER (WHERE last_signal_outcome IS NOT NULL)::int AS signals,
                MIN(recorded_at) AS first_tick,
                MAX(recorded_at) AS last_tick
         FROM algo_price_ticks
         WHERE condition_id = $1
           AND recorded_at BETWEEN $2::timestamptz AND $3::timestamptz + interval '3 min'`,
        [cid, WINDOW_START, WINDOW_END],
      );
      console.log('tick stats', j(ticks.rows[0]));

      const abstain = await c.query(
        `SELECT split_part(COALESCE(last_abstain_reason,'none'),':',1) AS r, COUNT(*)::int AS n
         FROM algo_price_ticks
         WHERE condition_id = $1 AND recorded_at BETWEEN $2 AND $3
         GROUP BY 1 ORDER BY n DESC LIMIT 10`,
        [cid, WINDOW_START, WINDOW_END],
      );
      console.log('abstain', j(abstain.rows));
    }

    // order signals for pending reservations
    const sigIds = [
      '970fca772f1d5ec4887caac4244f5ecc7c1b0aee8b1ccb7a75226069e344522c',
      'a460aa08bb77a1543bd7176a4a7d90c76a5e01ee49530204f8a94971fbd92d1b',
      'bdfcf9e2035218a729f2e07a26b33df8c611dc4dedee941515ec0be63f3bb89f',
      '857dd9d1e6584f63f6124485d9379656438cf97425045914b78546fd97cde6fc',
      '5a458f5a16beb1353fe4d7db9d3e8ce4535f0ebb35b701da1e6ed084388a8232',
    ];

    const sigCols = await c.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name='order_signals'`,
    );
    console.log('\norder_signals cols', sigCols.rows.map((r) => r.column_name).join(', '));

    const signals = await c.query(
      `SELECT * FROM order_signals WHERE id = ANY($1)`,
      [sigIds],
    );
    console.log('\nORDER SIGNALS', j(signals.rows));

    // Any executions for ALGO during window?
    const windowExecs = await c.query(
      `SELECT e.id, e.status, e.error, e.reason, e.copied_position_id, e.executed_at,
              p.condition_id, p.status AS pos_status, p.outcome
       FROM executions e
       JOIN copied_positions p ON p.id = e.copied_position_id
       WHERE (p.reason = 'ALGO_OPEN' OR e.reason = 'ALGO_OPEN')
         AND e.executed_at >= $1::timestamptz - interval '10 min'
         AND e.executed_at <= $3::timestamptz + interval '10 min'
       ORDER BY e.id DESC LIMIT 50`,
      [WINDOW_START, WINDOW_END, WINDOW_END],
    );
    console.log('\nWINDOW EXECS', j(windowExecs.rows));

    // cancelled reason - check if janitor cancelled
    const cancelledSample = await c.query(
      `SELECT id, condition_id, outcome, status, opened_at, closed_at, close_reason
       FROM copied_positions
       WHERE id IN (20733, 20739, 20755)`,
    );
    console.log('\nCANCELLED SAMPLE', j(cancelledSample.rows));

    // All algo positions created during window across all markets
    const windowPos = await c.query(
      `SELECT id, condition_id, outcome, status, mode
       FROM copied_positions
       WHERE reason = 'ALGO_OPEN' AND mode = 'sim'
         AND id >= 20700 AND id <= 20800
       ORDER BY id`,
    );
    console.log('\nALL POS 20700-20800', j(windowPos.rows));

  } finally {
    c.release();
    await pool.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
