import pg from 'pg';
import { loadMonorepoEnv } from '../packages/core/src/config/env.js';

loadMonorepoEnv();

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

function j(v: unknown) {
  return JSON.stringify(v, null, 2);
}

async function main() {
  const c = await pool.connect();
  try {
    console.log('=== WATCHLIST ===');
    const wl = await c.query(`
      SELECT id, trader_address, nickname, active, sim_enabled, real_enabled, created_at
      FROM watchlist
      ORDER BY id
    `);
    console.log(j(wl.rows));

    console.log('\n=== ALGO MARKET SELECTIONS ===');
    const sels = await c.query(`
      SELECT
        s.id, s.condition_id, s.enabled, s.question, s.crypto_symbol, s.interval, s.slug,
        s.created_at, s.updated_at,
        m.end_date, m.resolved, m.market_type, m.accepting_orders, m.question AS market_question
      FROM algo_market_selections s
      LEFT JOIN markets m ON m.condition_id = s.condition_id
      ORDER BY s.created_at DESC
      LIMIT 80
    `);
    console.log(`count=${sels.rowCount}`);
    console.log(j(sels.rows));

    console.log('\n=== ALGO SELECTIONS COUNTS ===');
    const selCounts = await c.query(`
      SELECT enabled, COUNT(*)::int AS n FROM algo_market_selections GROUP BY enabled
    `);
    console.log(j(selCounts.rows));

    console.log('\n=== ALGO AUTO TRACK RULES ===');
    const rules = await c.query(`SELECT * FROM algo_auto_track_rules ORDER BY id`);
    console.log(j(rules.rows));

    console.log('\n=== COPIED POSITIONS BY mode/status/source ===');
    const pos = await c.query(`
      SELECT mode, status, source, COUNT(*)::int AS n,
             MIN(opened_at) AS first_opened, MAX(opened_at) AS last_opened
      FROM copied_positions
      GROUP BY mode, status, source
      ORDER BY mode, status, source
    `);
    console.log(j(pos.rows));

    console.log('\n=== RECENT COPIED POSITIONS (30) ===');
    const recentPos = await c.query(`
      SELECT id, mode, status, source, condition_id, outcome, quantity, entry_price,
             opened_at, closed_at, close_reason, realized_pnl
      FROM copied_positions
      ORDER BY COALESCE(opened_at, closed_at) DESC NULLS LAST
      LIMIT 30
    `);
    console.log(j(recentPos.rows));

    console.log('\n=== EXECUTIONS summary ===');
    const ex = await c.query(`
      SELECT mode, status, side, COUNT(*)::int AS n,
             MIN(executed_at) AS first_at, MAX(executed_at) AS last_at
      FROM executions
      GROUP BY mode, status, side
      ORDER BY n DESC
    `);
    console.log(j(ex.rows));

    console.log('\n=== EXECUTION ERRORS ===');
    const errBreak = await c.query(`
      SELECT mode, error, COUNT(*)::int AS n
      FROM executions
      WHERE error IS NOT NULL
      GROUP BY mode, error
      ORDER BY n DESC
      LIMIT 40
    `);
    console.log(j(errBreak.rows));

    console.log('\n=== RECENT EXECUTIONS (30) ===');
    const recentEx = await c.query(`
      SELECT id, mode, status, side, reason, error, fill_price, fill_quantity,
             executed_at, order_signal_id, copied_position_id
      FROM executions
      ORDER BY COALESCE(executed_at, id) DESC
      LIMIT 30
    `);
    console.log(j(recentEx.rows));

    console.log('\n=== MOVE EVENTS summary ===');
    const moves = await c.query(`
      SELECT event_type, processed, COUNT(*)::int AS n,
             COUNT(*) FILTER (WHERE skip_reasons IS NOT NULL)::int AS with_skip,
             MIN(detected_at) AS first_at, MAX(detected_at) AS last_at
      FROM move_events
      GROUP BY event_type, processed
      ORDER BY n DESC
    `);
    console.log(j(moves.rows));

    console.log('\n=== MOVE SKIP REASONS (sim) ===');
    const skips = await c.query(`
      SELECT skip_reasons->>'sim' AS sim_skip, COUNT(*)::int AS n
      FROM move_events
      WHERE skip_reasons->>'sim' IS NOT NULL
      GROUP BY 1 ORDER BY n DESC LIMIT 30
    `);
    console.log(j(skips.rows));

    console.log('\n=== ALGO PRICE TICKS 24h ===');
    const ticks = await c.query(`
      SELECT COUNT(*)::int AS ticks_24h,
             COUNT(DISTINCT condition_id)::int AS markets,
             MIN(recorded_at) AS first_tick,
             MAX(recorded_at) AS last_tick
      FROM algo_price_ticks
      WHERE recorded_at > NOW() - INTERVAL '24 hours'
    `);
    console.log(j(ticks.rows[0]));

    console.log('\n=== ALGO TICKS BY MARKET (top 20 last 24h) ===');
    const ticksByMkt = await c.query(`
      SELECT t.condition_id, COUNT(*)::int AS n,
             MAX(t.recorded_at) AS last_tick,
             s.question, s.interval, s.enabled
      FROM algo_price_ticks t
      LEFT JOIN algo_market_selections s ON s.condition_id = t.condition_id
      WHERE t.recorded_at > NOW() - INTERVAL '24 hours'
      GROUP BY t.condition_id, s.question, s.interval, s.enabled
      ORDER BY n DESC
      LIMIT 20
    `);
    console.log(j(ticksByMkt.rows));

    console.log('\n=== ALGO SURVEILLANCE SNAPSHOTS ===');
    const surv = await c.query(`
      SELECT status, COUNT(*)::int AS n
      FROM algo_surveillance_snapshots
      GROUP BY status
    `);
    console.log(j(surv.rows));

    console.log('\n=== RECENT SURVEILLANCE (20) ===');
    const survRecent = await c.query(`
      SELECT id, condition_id, status, created_at, resolved_at
      FROM algo_surveillance_snapshots
      ORDER BY created_at DESC
      LIMIT 20
    `);
    console.log(j(survRecent.rows));

    console.log('\n=== POSITION RESERVATIONS ===');
    const resv = await c.query(`
      SELECT status, COUNT(*)::int AS n FROM position_reservations GROUP BY status
    `);
    console.log(j(resv.rows));

    console.log('\n=== CRYPTO ALGO FULL TUNABLES ===');
    const algo = await c.query(`
      SELECT
        crypto_algo_enabled,
        crypto_algo_strategies,
        crypto_algo_sl_enabled, crypto_algo_tp_enabled, crypto_algo_trailing_enabled,
        crypto_algo_sl_bid_points, crypto_algo_tp_bid_points,
        crypto_algo_sl_percent, crypto_algo_tp_percent,
        crypto_algo_trailing_stop_percent, crypto_algo_trailing_activation_percent,
        crypto_algo_pre_close_enabled, crypto_algo_pre_close_seconds,
        crypto_algo_pre_close_hold_if_winning, crypto_algo_pre_close_win_confidence_bid,
        crypto_algo_time_exit_enabled, crypto_algo_time_exit_seconds,
        crypto_algo_time_exit_win_confidence_bid, crypto_algo_time_exit_max_retries,
        crypto_algo_min_time_to_close, crypto_algo_reentry_window_ms,
        crypto_algo_max_entries_per_window, sl_confirmation_ticks,
        crypto_algo_base_threshold, crypto_algo_spread_adjustment_factor,
        crypto_algo_min_spread_abs_for_adjustment, crypto_algo_max_spread_abs,
        crypto_algo_price_sum_tolerance, crypto_algo_warn_price_deviation,
        crypto_algo_max_book_age_ms, crypto_algo_ws_debounce_ms, crypto_algo_poll_ms,
        crypto_algo_tick_interval_ms, crypto_algo_price_tick_ref_qty,
        crypto_algo_spread_abs_by_interval, crypto_algo_exit_defaults_by_interval,
        crypto_algo_pre_close_seconds_by_interval, crypto_algo_time_exit_seconds_by_interval
      FROM risk_config WHERE id = 1
    `);
    console.log(j(algo.rows[0]));

    // Check if there are any order signals leftover in redis? can't from DB.
    // Look at exit attempts
    console.log('\n=== EXIT ATTEMPT EVENTS (recent) ===');
    const exits = await c.query(`
      SELECT COUNT(*)::int AS n FROM exit_attempt_events
    `);
    console.log(j(exits.rows[0]));

    // Markets currently open among selections
    console.log('\n=== ENABLED SELECTIONS STILL OPEN ===');
    const openSels = await c.query(`
      SELECT s.condition_id, s.question, s.interval, s.crypto_symbol,
             m.end_date, m.resolved, m.accepting_orders,
             (m.end_date > NOW()) AS not_ended
      FROM algo_market_selections s
      LEFT JOIN markets m ON m.condition_id = s.condition_id
      WHERE s.enabled = true
      ORDER BY m.end_date ASC NULLS LAST
      LIMIT 40
    `);
    console.log(`count=${openSels.rowCount}`);
    console.log(j(openSels.rows));

    // Signal-like: check if copied_positions source = crypto_algo ever existed historically via snapshots
    console.log('\n=== SIM SNAPSHOTS (recent) ===');
    const snaps = await c.query(`
      SELECT id, source, label, created_at,
             LEFT(traders_json, 80) AS traders_preview
      FROM simulation_state_snapshots
      ORDER BY created_at DESC
      LIMIT 10
    `);
    console.log(j(snaps.rows));

  } finally {
    c.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
