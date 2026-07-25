import pg from 'pg';
import { loadMonorepoEnv } from '../packages/core/src/config/env.js';

loadMonorepoEnv();

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const j = (v: unknown) => JSON.stringify(v, null, 2);

async function main() {
  const c = await pool.connect();
  try {
    console.log('=== PENDING SIM POSITIONS ===');
    console.log(j((await c.query(`
      SELECT id, watchlist_id, condition_id, outcome, reason, status, mode,
             quantity, entry_price, opened_at, move_event_id
      FROM copied_positions WHERE mode='sim' AND status='pending'
      ORDER BY id DESC
    `)).rows));

    console.log('\n=== MOVE SKIP REASONS (cast) ===');
    console.log(j((await c.query(`
      SELECT
        (skip_reasons::jsonb)->>'sim' AS sim_skip,
        (skip_reasons::jsonb)->>'real' AS real_skip,
        COUNT(*)::int AS n
      FROM move_events
      WHERE skip_reasons IS NOT NULL
      GROUP BY 1, 2
      ORDER BY n DESC
      LIMIT 40
    `)).rows));

    console.log('\n=== RECENT MOVES WITH SKIP ===');
    console.log(j((await c.query(`
      SELECT id, trader_address, event_type, detected_at, skip_reasons,
             condition_id, trader_size, previous_trader_size
      FROM move_events
      ORDER BY detected_at DESC
      LIMIT 15
    `)).rows));

    console.log('\n=== ALGO SELECTIONS COUNTS ===');
    console.log(j((await c.query(`
      SELECT enabled, COUNT(*)::int AS n FROM algo_market_selections GROUP BY enabled
    `)).rows));

    console.log('\n=== AUTO TRACK RULES ===');
    console.log(j((await c.query(`SELECT * FROM algo_auto_track_rules ORDER BY id`)).rows));

    console.log('\n=== ALGO TICKS 24h / 2h ===');
    console.log(j((await c.query(`
      SELECT
        (SELECT COUNT(*)::int FROM algo_price_ticks WHERE recorded_at > NOW() - INTERVAL '24 hours') AS ticks_24h,
        (SELECT COUNT(DISTINCT condition_id)::int FROM algo_price_ticks WHERE recorded_at > NOW() - INTERVAL '24 hours') AS markets_24h,
        (SELECT COUNT(*)::int FROM algo_price_ticks WHERE recorded_at > NOW() - INTERVAL '2 hours') AS ticks_2h,
        (SELECT MAX(recorded_at) FROM algo_price_ticks) AS last_tick,
        (SELECT MIN(recorded_at) FROM algo_price_ticks WHERE recorded_at > NOW() - INTERVAL '24 hours') AS first_tick_24h
    `)).rows[0]));

    console.log('\n=== LAST TICKS ===');
    console.log(j((await c.query(`
      SELECT t.condition_id, t.up_price, t.down_price, t.seconds_until_end,
             t.book_staleness_ms, t.ws_healthy, t.recorded_at, s.question, s.interval, s.enabled
      FROM algo_price_ticks t
      LEFT JOIN algo_market_selections s ON s.condition_id = t.condition_id
      ORDER BY t.recorded_at DESC LIMIT 10
    `)).rows));

    console.log('\n=== ENABLED SELECTIONS NOW ===');
    console.log(j((await c.query(`
      SELECT COUNT(*) FILTER (WHERE s.enabled)::int AS enabled,
             COUNT(*) FILTER (WHERE s.enabled AND (m.end_date IS NULL OR m.end_date > NOW()) AND COALESCE(m.resolved,false)=false)::int AS enabled_open
      FROM algo_market_selections s
      LEFT JOIN markets m ON m.condition_id = s.condition_id
    `)).rows[0]));

    console.log('\n=== SAMPLE ENABLED ===');
    console.log(j((await c.query(`
      SELECT s.question, s.interval, s.crypto_symbol, m.end_date, m.accepting_orders, s.enabled
      FROM algo_market_selections s
      LEFT JOIN markets m ON m.condition_id = s.condition_id
      WHERE s.enabled = true
      ORDER BY m.end_date ASC NULLS LAST LIMIT 12
    `)).rows));

    console.log('\n=== SIM EXECUTIONS EVER ===');
    console.log(j((await c.query(`
      SELECT status, side, COUNT(*)::int AS n FROM executions WHERE mode='sim' GROUP BY status, side
    `)).rows));

    console.log('\n=== POSITIONS watchlist crypto-algo (40) ===');
    console.log(j((await c.query(`
      SELECT mode, status, COUNT(*)::int AS n,
             MIN(opened_at) AS first_opened, MAX(opened_at) AS last_opened
      FROM copied_positions WHERE watchlist_id = 40
      GROUP BY mode, status
    `)).rows));

    console.log('\n=== RESERVATIONS recent ===');
    console.log(j((await c.query(`
      SELECT status, COUNT(*)::int AS n,
             MIN(created_at) AS first_at, MAX(created_at) AS last_at
      FROM position_reservations GROUP BY status
    `)).rows));

    console.log('\n=== SURVEILLANCE ===');
    console.log(j((await c.query(`
      SELECT status, COUNT(*)::int AS n FROM algo_surveillance_snapshots GROUP BY status
    `)).rows));

    console.log('\n=== SIM RESET TIMING ===');
    console.log(j((await c.query(`SELECT * FROM simulation_balances`)).rows));
    console.log(j((await c.query(`
      SELECT id, source, label, created_at FROM simulation_state_snapshots
      ORDER BY created_at DESC LIMIT 8
    `)).rows));

    // Check reason field on pending
    console.log('\n=== PENDING reasons ===');
    console.log(j((await c.query(`
      SELECT reason, COUNT(*)::int AS n FROM copied_positions
      WHERE mode='sim' AND status='pending' GROUP BY reason
    `)).rows));

  } finally {
    c.release();
    await pool.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
