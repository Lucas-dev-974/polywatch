import pg from 'pg';
import { loadMonorepoEnv } from '../packages/core/src/config/env.js';
loadMonorepoEnv();
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const j = (v: unknown) => JSON.stringify(v, null, 2);

const MARKETS = {
  BTC: '0x20af38b77be70bd48f1b42080c45aeecc122f5b19705e8cec132c5cd77d2c27c',
  XRP: '0xf7e828e9b6080dfb5b96b0d2cd7cb58db5f7e984c44adf1e15b67f9792db4e78',
  SOL: '0xf33fbe327f6ccbc4e4ea9c1639cb6cfd15dfcc5895f1e6d543678e43b8a0868b',
};

async function main() {
  const c = await pool.connect();
  try {
    const snaps = await c.query(`
      SELECT id, condition_id, crypto_symbol, market_start_at, market_end_at,
             close_captured_at, open_up_price, open_down_price, question
      FROM algo_surveillance_snapshots
      WHERE market_start_at >= '2026-07-11T14:48:00Z'
        AND market_start_at <= '2026-07-11T14:52:00Z'
      ORDER BY crypto_symbol`);
    console.log('SNAPS 14:50 UTC', j(snaps.rows));

    for (const [sym, cid] of Object.entries(MARKETS)) {
      console.log(`\n==== ${sym} ${cid} ====`);
      const m = await c.query('SELECT question FROM markets WHERE condition_id=$1', [cid]);
      console.log('question', m.rows[0]?.question);

      const pos = await c.query(`
        SELECT id, outcome, status, opened_at FROM copied_positions
        WHERE condition_id=$1 AND reason='ALGO_OPEN' ORDER BY id`, [cid]);
      console.log('positions', j(pos.rows));

      const ex = await c.query(`
        SELECT e.id, e.copied_position_id, e.status, e.error, e.order_signal_id
        FROM executions e JOIN copied_positions p ON p.id=e.copied_position_id
        WHERE p.condition_id=$1 ORDER BY e.id`, [cid]);
      console.log('executions', j(ex.rows));

      const resv = await c.query(`
        SELECT r.copied_position_id, r.order_signal_id, r.created_at, r.expires_at
        FROM position_reservations r JOIN copied_positions p ON p.id=r.copied_position_id
        WHERE p.condition_id=$1`, [cid]);
      console.log('reservations', j(resv.rows));

      const abstain = await c.query(`
        SELECT split_part(COALESCE(last_abstain_reason,'none'),':',1) AS r, COUNT(*)::int AS n
        FROM algo_price_ticks
        WHERE condition_id=$1 AND recorded_at >= '2026-07-11T14:50:00Z'
          AND recorded_at <= '2026-07-11T14:57:00Z'
        GROUP BY 1 ORDER BY n DESC`, [cid]);
      console.log('abstain', j(abstain.rows));

      const sigs = await c.query(`
        SELECT COUNT(*)::int AS n FROM algo_price_ticks
        WHERE condition_id=$1 AND last_signal_outcome IS NOT NULL
          AND recorded_at >= '2026-07-11T14:50:00Z'`, [cid]);
      console.log('signal_ticks', sigs.rows[0]);
    }
  } finally {
    c.release();
    await pool.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
