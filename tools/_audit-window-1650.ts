/**
 * Audit fenêtre 16:50→16:55 — BTC/XRP/SOL 5m (positions screenshot)
 */
import pg from 'pg';
import { loadMonorepoEnv } from '../packages/core/src/config/env.js';

loadMonorepoEnv();

const POSITION_IDS = [
  20733, 20739, 20755, 20746, 20750, 20741, 20765, // BTC
  20771, 20760, 20752, 20773, 20768, 20756, 20748, // XRP
  20759, 20754, 20766, 20757, 20764, 20742, 20751, 20747, // SOL
];

const WINDOW_START = '2026-07-11T14:50:00.000Z'; // 16:50 UTC+2
const WINDOW_END = '2026-07-11T14:55:00.000Z';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

function j(v: unknown) {
  return JSON.stringify(v, null, 2);
}

async function main() {
  const c = await pool.connect();
  try {
    console.log('\n========== AUDIT FENÊTRE 16:50→16:55 ==========\n');

    const positions = await c.query(
      `SELECT id, condition_id, outcome, status, mode, quantity, entry_price,
              reason, opened_at, closed_at, close_reason, asset_id
       FROM copied_positions WHERE id = ANY($1) ORDER BY id`,
      [POSITION_IDS],
    );
    console.log(`--- positions (${positions.rowCount}) ---`);
    console.log(j(positions.rows));

    const conditionIds = [...new Set(positions.rows.map((r) => r.condition_id as string))];
    console.log('\n--- conditionIds ---');
    console.log(conditionIds);

    const markets = await c.query(
      `SELECT condition_id, question, end_date, resolved, closed, accepting_orders,
              token_id_yes, token_id_no
       FROM markets WHERE condition_id = ANY($1)`,
      [conditionIds],
    );
    console.log('\n--- markets ---');
    console.log(j(markets.rows));

    const selections = await c.query(
      `SELECT id, condition_id, crypto_symbol, interval, enabled, created_at
       FROM algo_market_selections
       WHERE condition_id = ANY($1)
       ORDER BY created_at DESC`,
      [conditionIds],
    );
    console.log('\n--- algo_market_selections (recent) ---');
    console.log(j(selections.rows));

    const snapshots = await c.query(
      `SELECT id, condition_id, crypto_symbol, interval, market_start_at, market_end_at,
              open_captured_at, close_captured_at, positions_json, winning_outcome
       FROM algo_surveillance_snapshots
       WHERE market_start_at = $1::timestamptz
         AND market_end_at = $2::timestamptz
       ORDER BY crypto_symbol`,
      [WINDOW_START, WINDOW_END],
    );
    console.log('\n--- surveillance snapshots (16:50→16:55) ---');
    for (const snap of snapshots.rows) {
      console.log(`\n[${snap.crypto_symbol} ${snap.interval}] condition=${snap.condition_id}`);
      let positionsJson: unknown[] = [];
      try {
        positionsJson = JSON.parse(snap.positions_json ?? '[]');
      } catch {
        positionsJson = [];
      }
      console.log('positions in snapshot:', j(positionsJson));
    }

    const execs = await c.query(
      `SELECT e.id, e.copied_position_id, e.status, e.error, e.reason, e.side,
              e.fill_quantity, e.fill_price, e.order_signal_id, e.executed_at, e.mode
       FROM executions e
       WHERE e.copied_position_id = ANY($1)
       ORDER BY e.id`,
      [POSITION_IDS],
    );
    console.log('\n--- executions ---');
    console.log(j(execs.rows));

    const resv = await c.query(
      `SELECT * FROM position_reservations
       WHERE copied_position_id = ANY($1) ORDER BY id`,
      [POSITION_IDS],
    );
    console.log('\n--- reservations ---');
    console.log(j(resv.rows));

    for (const conditionId of conditionIds) {
      console.log(`\n========== TICKS ${conditionId} ==========`);

      const abstain = await c.query(
        `SELECT
           split_part(COALESCE(last_abstain_reason, 'none'), ':', 1) AS reason,
           COUNT(*)::int AS n
         FROM algo_price_ticks
         WHERE condition_id = $1
           AND recorded_at >= $2::timestamptz
           AND recorded_at <= $3::timestamptz + interval '2 minutes'
         GROUP BY 1 ORDER BY n DESC`,
        [conditionId, WINDOW_START, WINDOW_END],
      );
      console.log('abstain counts:', j(abstain.rows));

      const signals = await c.query(
        `SELECT recorded_at, last_signal_outcome, last_abstain_reason,
                up_price, down_price, seconds_until_end
         FROM algo_price_ticks
         WHERE condition_id = $1
           AND last_signal_outcome IS NOT NULL
           AND recorded_at >= $2::timestamptz
           AND recorded_at <= $3::timestamptz + interval '2 minutes'
         ORDER BY recorded_at LIMIT 30`,
        [conditionId, WINDOW_START, WINDOW_END],
      );
      console.log(`signal ticks (${signals.rowCount}):`, j(signals.rows));

      const firstSignal = await c.query(
        `SELECT recorded_at, last_signal_outcome, last_abstain_reason
         FROM algo_price_ticks
         WHERE condition_id = $1
           AND last_signal_outcome IS NOT NULL
           AND recorded_at >= $2::timestamptz
         ORDER BY recorded_at ASC LIMIT 1`,
        [conditionId, WINDOW_START],
      );
      console.log('first signal:', j(firstSignal.rows[0] ?? null));
    }

    // Status breakdown
    const statusBreakdown = await c.query(
      `SELECT status, close_reason, COUNT(*)::int AS n
       FROM copied_positions WHERE id = ANY($1)
       GROUP BY status, close_reason ORDER BY n DESC`,
      [POSITION_IDS],
    );
    console.log('\n--- status breakdown ---');
    console.log(j(statusBreakdown.rows));

    const execStatus = await c.query(
      `SELECT e.status, e.error, COUNT(*)::int AS n
       FROM executions e
       WHERE e.copied_position_id = ANY($1)
       GROUP BY e.status, e.error ORDER BY n DESC`,
      [POSITION_IDS],
    );
    console.log('\n--- execution status breakdown ---');
    console.log(j(execStatus.rows));

  } finally {
    c.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
