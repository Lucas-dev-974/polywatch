import pg from 'pg';
import { loadMonorepoEnv } from '../packages/core/src/config/env.js';
loadMonorepoEnv();
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const j = (v: unknown) => JSON.stringify(v, null, 2);

async function main() {
  const c = await pool.connect();
  try {
    const snaps = await c.query(`
      SELECT id, condition_id, crypto_symbol, interval, market_start_at, market_end_at,
             open_captured_at, close_captured_at, unresolved_at
      FROM algo_surveillance_snapshots
      WHERE market_start_at >= '2026-07-11T12:00:00Z'
        AND market_start_at <= '2026-07-11T15:00:00Z'
      ORDER BY market_start_at DESC, crypto_symbol`);
    console.log('SNAPS', j(snaps.rows));

    for (const sym of ['Bitcoin', 'XRP', 'Solana']) {
      const row = await c.query(`
        SELECT condition_id FROM algo_surveillance_snapshots
        WHERE crypto_symbol = $1 AND interval = '5m'
          AND market_start_at = '2026-07-11T14:50:00.000Z'
      `, [sym]);
      const cid = row.rows[0]?.condition_id;
      console.log(`\n${sym} window cid`, cid);
      if (!cid) continue;
      const pos = await c.query(`
        SELECT p.id, p.outcome, p.status, p.condition_id, m.question
        FROM copied_positions p
        LEFT JOIN markets m ON m.condition_id = p.condition_id
        WHERE p.condition_id = $1 AND p.reason LIKE 'ALGO_%'
        ORDER BY p.id`, [cid]);
      console.log('positions on snapshot cid', j(pos.rows));

      // also positions opened during window time on same crypto (wrong markets)
      const bleed = await c.query(`
        SELECT p.id, p.outcome, p.status, p.condition_id, m.question, s.crypto_symbol
        FROM copied_positions p
        JOIN markets m ON m.condition_id = p.condition_id
        LEFT JOIN algo_market_selections s ON s.condition_id = p.condition_id
        WHERE p.id BETWEEN 20730 AND 20780 AND p.reason = 'ALGO_OPEN'
        ORDER BY p.id`);
      console.log('ALL 20730-20780', j(bleed.rows));
    }

    // executions for pending 20746, 20765 etc
    const pendExec = await c.query(`
      SELECT p.id, p.status, p.condition_id, e.id AS exec_id, e.status AS exec_status, e.error
      FROM copied_positions p
      LEFT JOIN executions e ON e.copied_position_id = p.id
      WHERE p.id IN (20746, 20756, 20764, 20765, 20773)
      ORDER BY p.id, e.id`);
    console.log('\nPENDING EXEC', j(pendExec.rows));

    // placing janitor - executions stuck placing?
    const placing = await c.query(`
      SELECT e.id, e.copied_position_id, e.status, e.error, e.order_signal_id
      FROM executions e
      WHERE e.copied_position_id BETWEEN 20730 AND 20780
      ORDER BY e.id`);
    console.log('\nEXECS 20730-20780', j(placing.rows));

  } finally { c.release(); await pool.end(); }
}
main().catch(e => { console.error(e); process.exit(1); });
