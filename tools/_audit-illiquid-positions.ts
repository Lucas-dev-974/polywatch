import pg from 'pg';
import { loadMonorepoEnv } from '../packages/core/src/config/env.js';

loadMonorepoEnv();
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const c = await pool.connect();
  try {
    const ids = [22012, 22026, 22027];
    const pos = await c.query(
      `SELECT p.id, p.status, p.close_reason, p.outcome, p.condition_id, p.asset_id,
              p.opened_at, p.quantity, p.entry_price
       FROM copied_positions p WHERE p.id = ANY($1) ORDER BY p.id`,
      [ids],
    );
    console.log('POSITIONS', JSON.stringify(pos.rows, null, 2));

    const ex = await c.query(
      `SELECT e.id, e.copied_position_id, e.status, e.error, e.side,
              e.requested_qty, e.reference_vwap, e.fill_price, e.fill_quantity,
              e.order_signal_id, e.executed_at
       FROM executions e WHERE e.copied_position_id = ANY($1) ORDER BY e.id`,
      [ids],
    );
    console.log('EXECUTIONS', JSON.stringify(ex.rows, null, 2));

    const resv = await c.query(
      `SELECT r.id, r.copied_position_id, r.order_signal_id, r.reserved_notional_usdc,
              r.created_at, r.expires_at
       FROM position_reservations r WHERE r.copied_position_id = ANY($1)`,
      [ids],
    );
    console.log('RESERVATIONS', JSON.stringify(resv.rows, null, 2));

    const cid = pos.rows[0]?.condition_id;
    if (cid) {
      const snap = await c.query(
        `SELECT condition_id, question, crypto_symbol, interval, market_start_at, market_end_at
         FROM algo_surveillance_snapshots WHERE condition_id = $1`,
        [cid],
      );
      console.log('SNAPSHOT', JSON.stringify(snap.rows, null, 2));

      const ticks = await c.query(
        `SELECT recorded_at, yes_price, last_abstain_reason, last_abstain_detail
         FROM algo_price_ticks
         WHERE condition_id = $1 AND recorded_at >= NOW() - INTERVAL '15 minutes'
         ORDER BY recorded_at DESC LIMIT 8`,
        [cid],
      );
      console.log('TICKS', JSON.stringify(ticks.rows, null, 2));
    }
  } finally {
    c.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
