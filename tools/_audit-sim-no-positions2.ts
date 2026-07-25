import pg from 'pg';
import { loadMonorepoEnv } from '../packages/core/src/config/env.js';

loadMonorepoEnv();

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const j = (v: unknown) => JSON.stringify(v, null, 2);

async function main() {
  const c = await pool.connect();
  try {
    console.log('=== COPIED_POSITIONS columns ===');
    const cols = await c.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'copied_positions' ORDER BY ordinal_position
    `);
    console.log(cols.rows.map((r) => r.column_name).join(', '));

    console.log('\n=== POSITIONS BY mode/status ===');
    console.log(j((await c.query(`
      SELECT mode, status, COUNT(*)::int AS n,
             MIN(opened_at) AS first_opened, MAX(opened_at) AS last_opened
      FROM copied_positions GROUP BY mode, status ORDER BY 1,2
    `)).rows));

    console.log('\n=== POSITIONS crypto-algo trader ===');
    console.log(j((await c.query(`
      SELECT id, mode, status, condition_id, outcome, quantity, entry_price,
             opened_at, closed_at, close_reason, realized_pnl, watchlist_id
      FROM copied_positions
      WHERE watchlist_id = 40 OR condition_id LIKE '0x%'
      ORDER BY opened_at DESC NULLS LAST
      LIMIT 20
    `)).rows));

    console.log('\n=== ALL POSITIONS COUNT ===');
    console.log(j((await c.query(`SELECT COUNT(*)::int AS n FROM copied_positions`)).rows[0]));

    console.log('\n=== EXECUTIONS summary ===');
    console.log(j((await c.query(`
      SELECT mode, status, side, COUNT(*)::int AS n,
             MIN(executed_at) AS first_at, MAX(executed_at) AS last_at
      FROM executions GROUP BY mode, status, side ORDER BY n DESC
    `)).rows));

    console.log('\n=== EXECUTION ERRORS ===');
    console.log(j((await c.query(`
      SELECT mode, error, COUNT(*)::int AS n FROM executions
      WHERE error IS NOT NULL GROUP BY mode, error ORDER BY n DESC LIMIT 40
    `)).rows));

    console.log('\n=== RECENT EXECUTIONS ===');
    console.log(j((await c.query(`
      SELECT id, mode, status, side, reason, error, fill_price, fill_quantity,
             executed_at, order_signal_id, copied_position_id
      FROM executions ORDER BY id DESC LIMIT 30
    `)).rows));

    console.log('\n=== MOVE EVENTS summary ===');
    console.log(j((await c.query(`
      SELECT event_type, processed, COUNT(*)::int AS n,
             COUNT(*) FILTER (WHERE skip_reasons IS NOT NULL)::int AS with_skip,
             MIN(detected_at) AS first_at, MAX(detected_at) AS last_at
      FROM move_events GROUP BY event_type, processed ORDER BY n DESC
    `)).rows));

    console.log('\n=== MOVE SKIP REASONS sim ===');
    console.log(j((await c.query(`
      SELECT skip_reasons->>'sim' AS sim_skip, COUNT(*)::int AS n
      FROM move_events WHERE skip_reasons->>'sim' IS NOT NULL
      GROUP BY 1 ORDER BY n DESC LIMIT 30
    `)).rows));

    console.log('\n=== ALGO SELECTIONS COUNTS ===');
    console.log(j((await c.query(`
      SELECT enabled, COUNT(*)::int AS n FROM algo_market_selections GROUP BY enabled
    `)).rows));

    console.log('\n=== ALGO AUTO TRACK RULES ===');
    console.log(j((await c.query(`SELECT * FROM algo_auto_track_rules ORDER BY id`)).rows));

    console.log('\n=== ALGO PRICE TICKS 24h ===');
    console.log(j((await c.query(`
      SELECT COUNT(*)::int AS ticks_24h,
             COUNT(DISTINCT condition_id)::int AS markets,
             MIN(recorded_at) AS first_tick, MAX(recorded_at) AS last_tick
      FROM algo_price_ticks WHERE recorded_at > NOW() - INTERVAL '24 hours'
    `)).rows[0]));

    console.log('\n=== ALGO TICKS last 2h by market ===');
    console.log(j((await c.query(`
      SELECT t.condition_id, COUNT(*)::int AS n, MAX(t.recorded_at) AS last_tick,
             s.question, s.interval, s.enabled
      FROM algo_price_ticks t
      LEFT JOIN algo_market_selections s ON s.condition_id = t.condition_id
      WHERE t.recorded_at > NOW() - INTERVAL '2 hours'
      GROUP BY t.condition_id, s.question, s.interval, s.enabled
      ORDER BY last_tick DESC LIMIT 25
    `)).rows));

    console.log('\n=== SURVEILLANCE STATUS ===');
    console.log(j((await c.query(`
      SELECT status, COUNT(*)::int AS n FROM algo_surveillance_snapshots GROUP BY status
    `)).rows));

    console.log('\n=== RESERVATIONS ===');
    console.log(j((await c.query(`
      SELECT status, COUNT(*)::int AS n FROM position_reservations GROUP BY status
    `)).rows));

    console.log('\n=== ENABLED OPEN SELECTIONS NOW ===');
    console.log(j((await c.query(`
      SELECT COUNT(*)::int AS enabled_open
      FROM algo_market_selections s
      LEFT JOIN markets m ON m.condition_id = s.condition_id
      WHERE s.enabled = true AND (m.end_date IS NULL OR m.end_date > NOW())
        AND COALESCE(m.resolved, false) = false
    `)).rows[0]));

    console.log('\n=== SAMPLE ENABLED OPEN ===');
    console.log(j((await c.query(`
      SELECT s.condition_id, s.question, s.interval, s.crypto_symbol,
             m.end_date, m.resolved, m.accepting_orders
      FROM algo_market_selections s
      LEFT JOIN markets m ON m.condition_id = s.condition_id
      WHERE s.enabled = true
      ORDER BY m.end_date ASC NULLS LAST LIMIT 15
    `)).rows));

    // Look at recent ticks for signal-ish fields
    console.log('\n=== RECENT TICK SAMPLE (with signal fields if any) ===');
    const tickCols = await c.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'algo_price_ticks' ORDER BY ordinal_position
    `);
    console.log('cols:', tickCols.rows.map((r) => r.column_name).join(', '));

    console.log('\n=== LAST 5 TICKS ===');
    console.log(j((await c.query(`
      SELECT condition_id, up_price, down_price, up_bid, up_ask, down_bid, down_ask,
             up_spread_pct, down_spread_pct, seconds_until_end, book_staleness_ms,
             ws_healthy, recorded_at
      FROM algo_price_ticks ORDER BY recorded_at DESC LIMIT 5
    `)).rows));

    // Check if sim reset wiped positions today
    console.log('\n=== SIM BALANCE + SNAPSHOTS TODAY ===');
    console.log(j((await c.query(`SELECT * FROM simulation_balances`)).rows));
    console.log(j((await c.query(`
      SELECT id, source, label, created_at FROM simulation_state_snapshots
      ORDER BY created_at DESC LIMIT 10
    `)).rows));

    // Historical positions before reset? snapshots may have them
    console.log('\n=== SNAPSHOT POSITION COUNTS ===');
    console.log(j((await c.query(`
      SELECT id, source, label, created_at,
             CASE WHEN positions_json IS NULL THEN 0
                  WHEN positions_json = '[]' THEN 0
                  ELSE jsonb_array_length(positions_json::jsonb) END AS pos_count
      FROM simulation_state_snapshots
      ORDER BY created_at DESC LIMIT 15
    `)).rows));

  } finally {
    c.release();
    await pool.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
