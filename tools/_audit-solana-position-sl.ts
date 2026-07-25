import pg from 'pg';
import { loadMonorepoEnv } from '../packages/core/src/config/env.js';

loadMonorepoEnv();

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const j = (v: unknown) => JSON.stringify(v, null, 2);

async function main() {
  const c = await pool.connect();
  try {
    // Marché cible: Solana Up or Down - July 10, 12:05PM-12:10PM ET
    const TARGET_CONDITION_ID = '0xb065b90b124c056f58a5f9876f9467d201ad3b6a3ecfacbcc888a62a52ff6ee0';

    console.log('=== MARCHÉ CIBLE: Solana 12:05PM-12:10PM ET ===');
    const market = await c.query(`
      SELECT condition_id, slug, question, end_date, resolved, accepting_orders, market_type,
             winning_token_id
      FROM markets
      WHERE condition_id = $1
    `, [TARGET_CONDITION_ID]);
    console.log(j(market.rows));

    console.log('\n=== ALGO MARKET SELECTIONS ===');
    const sels = await c.query(`
      SELECT s.*, m.end_date, m.resolved, m.accepting_orders, m.question
      FROM algo_market_selections s
      LEFT JOIN markets m ON m.condition_id = s.condition_id
      WHERE s.condition_id = $1
    `, [TARGET_CONDITION_ID]);
    console.log(j(sels.rows));

    console.log(`\n=== POSITIONS POUR ${TARGET_CONDITION_ID} ===`);
    const positions = await c.query(`
      SELECT p.id, p.mode, p.status, p.reason, p.outcome, p.quantity,
             p.entry_price, p.entry_bid_vwap, p.sl_percent, p.sl_bid_points,
             p.tp_percent, p.tp_bid_points, p.realized_pnl, p.unrealized_pnl,
             p.peak_closure_pnl_percent, p.close_reason,
             p.opened_at, p.closed_at,
             p.entry_fees_remaining, p.entry_quantity_remaining,
             p.last_exit_block_reason, p.last_exit_block_close_reason,
             p.exit_emit_blocked_count, p.first_exit_block_at, p.last_exit_block_at,
             p.watchlist_id
      FROM copied_positions p
      WHERE p.condition_id = $1
      ORDER BY p.opened_at DESC
    `, [TARGET_CONDITION_ID]);
    console.log(j(positions.rows));

    for (const pos of positions.rows) {
      console.log(`\n${'='.repeat(70)}`);
      console.log(`POSITION #${pos.id} - ${pos.outcome} - ${pos.status} - close_reason: ${pos.close_reason}`);
      console.log(`${'='.repeat(70)}`);

      const execs = await c.query(`
        SELECT id, side, status, reason, error, fill_price, fill_quantity,
               realized_pnl, executed_at
        FROM executions
        WHERE copied_position_id = $1
        ORDER BY id
      `, [pos.id]);
      console.log('Executions:', j(execs.rows));

      const tickStats = await c.query(`
        SELECT
          COUNT(*)::int AS total_ticks,
          COUNT(*) FILTER (WHERE executable_bid_vwap IS NOT NULL AND executable_bid_vwap > 0)::int AS vwap_ticks,
          MIN(executable_bid_vwap) FILTER (WHERE executable_bid_vwap > 0) AS min_vwap,
          MAX(executable_bid_vwap) FILTER (WHERE executable_bid_vwap > 0) AS max_vwap,
          MIN(best_bid) FILTER (WHERE best_bid > 0) AS min_bid,
          MAX(best_bid) FILTER (WHERE best_bid > 0) AS max_bid,
          MIN(created_at) AS first_tick,
          MAX(created_at) AS last_tick
        FROM market_position_ticks
        WHERE copied_position_id = $1
      `, [pos.id]);
      console.log('Tick stats:', j(tickStats.rows));

      const lowTicks = await c.query(`
        SELECT created_at, executable_bid_vwap, best_bid, last_trade_price,
               ((COALESCE(NULLIF(executable_bid_vwap,0), NULLIF(best_bid,0), NULLIF(last_trade_price,0)) - $2::real) / $2::real * 100) AS trigger_pnl_pct
        FROM market_position_ticks
        WHERE copied_position_id = $1
          AND COALESCE(NULLIF(executable_bid_vwap,0), NULLIF(best_bid,0), NULLIF(last_trade_price,0)) IS NOT NULL
        ORDER BY COALESCE(NULLIF(executable_bid_vwap,0), NULLIF(best_bid,0), NULLIF(last_trade_price,0)) ASC
        LIMIT 10
      `, [pos.id, pos.entry_bid_vwap || pos.entry_price]);
      console.log('Lowest ticks (by price):', j(lowTicks.rows));

      const allTicks = await c.query(`
        SELECT created_at, executable_bid_vwap, best_bid, last_trade_price
        FROM market_position_ticks
        WHERE copied_position_id = $1
        ORDER BY created_at
      `, [pos.id]);
      console.log(`All ticks (${allTicks.rows.length}):`, j(allTicks.rows));

      if (pos.sl_bid_points && pos.entry_bid_vwap) {
        const slThreshold = Number(pos.entry_bid_vwap) - Number(pos.sl_bid_points);
        console.log(`\nSL Analysis:`);
        console.log(`  entry_bid_vwap: ${pos.entry_bid_vwap}`);
        console.log(`  sl_bid_points: ${pos.sl_bid_points}`);
        console.log(`  sl_threshold: ${slThreshold.toFixed(4)}`);
        console.log(`  sl_percent: ${pos.sl_percent}`);

        const breachTicks = await c.query(`
          SELECT created_at, executable_bid_vwap, best_bid, last_trade_price
          FROM market_position_ticks
          WHERE copied_position_id = $1
            AND COALESCE(NULLIF(executable_bid_vwap,0), NULLIF(best_bid,0), NULLIF(last_trade_price,0)) <= $2
          ORDER BY created_at
        `, [pos.id, slThreshold]);
        console.log(`  Ticks below SL threshold: ${breachTicks.rows.length}`);
        if (breachTicks.rows.length > 0) {
          console.log('  Breach ticks:', j(breachTicks.rows));
        } else {
          console.log('  => SL threshold NEVER breached in ticks');
        }
      }

      if (pos.exit_emit_blocked_count > 0 || pos.last_exit_block_reason) {
        console.log('\nExit block info:', {
          last_exit_block_reason: pos.last_exit_block_reason,
          last_exit_block_close_reason: pos.last_exit_block_close_reason,
          exit_emit_blocked_count: pos.exit_emit_blocked_count,
          first_exit_block_at: pos.first_exit_block_at,
          last_exit_block_at: pos.last_exit_block_at,
        });
      }
    }

    console.log(`\n=== SURVEILLANCE SNAPSHOTS POUR ${TARGET_CONDITION_ID} ===`);
    const surv = await c.query(`
      SELECT id, condition_id, status, created_at, resolved_at
      FROM algo_surveillance_snapshots
      WHERE condition_id = $1
      ORDER BY created_at DESC
      LIMIT 20
    `, [TARGET_CONDITION_ID]);
    console.log(j(surv.rows));

    console.log(`\n=== ALGO PRICE TICKS POUR ${TARGET_CONDITION_ID} ===`);
    const ticks = await c.query(`
      SELECT condition_id, up_price, down_price, up_bid, up_ask, down_bid, down_ask,
             up_spread_pct, down_spread_pct, seconds_until_end, book_staleness_ms,
             ws_healthy, recorded_at
      FROM algo_price_ticks
      WHERE condition_id = $1
      ORDER BY recorded_at DESC
      LIMIT 30
    `, [TARGET_CONDITION_ID]);
    console.log(j(ticks.rows));

    console.log('\n=== RISK CONFIG (SL settings) ===');
    const rc = await c.query(`
      SELECT crypto_algo_sl_enabled, crypto_algo_sl_bid_points, crypto_algo_sl_percent,
             sl_confirmation_ticks, crypto_algo_min_time_to_close,
             crypto_algo_exit_defaults_by_interval
      FROM risk_config WHERE id = 1
    `);
    console.log(j(rc.rows[0]));

  } finally {
    c.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
