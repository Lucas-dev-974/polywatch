import pg from 'pg';
import { loadMonorepoEnv } from '../packages/core/src/config/env.js';
loadMonorepoEnv();
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const c = await pool.connect();
  try {
    const snap = await c.query(`
      SELECT * FROM algo_surveillance_snapshots
      WHERE condition_id IN (
        '0x20af38b77be70bd48f1b42080c45aeecc122f5b19705e8cec132c5cd77d2c27c',
        '0xf7e828e9b6080dfb5b96b0d2cd7cb58db5f7e984c44adf1e15b67f9792db4e78',
        '0xf33fbe327f6ccbc4e4ea9c1639cb6cfd15dfcc5895f1e6d543678e43b8a0868b'
      )`);
    console.log('surveillance rows', JSON.stringify(snap.rows, null, 2));

    const ex = await c.query(`
      SELECT e.id, e.copied_position_id, e.status, e.error, e.executed_at, p.condition_id
      FROM executions e JOIN copied_positions p ON p.id=e.copied_position_id
      WHERE p.reason='ALGO_OPEN' AND e.id >= 75000
      ORDER BY e.id DESC LIMIT 30`);
    console.log('recent execs', JSON.stringify(ex.rows, null, 2));

    // First cancelled position on BTC market - any trail?
    const first = await c.query(`
      SELECT id FROM copied_positions
      WHERE condition_id='0x20af38b77be70bd48f1b42080c45aeecc122f5b19705e8cec132c5cd77d2c27c'
      AND reason='ALGO_OPEN' ORDER BY id LIMIT 1`);
    const pid = first.rows[0]?.id;
    if (pid) {
      const resvHist = await c.query(`
        SELECT * FROM position_reservations WHERE copied_position_id=$1`, [pid]);
      console.log('resv for first pos', pid, resvHist.rows);
    }

    // abstain on BTC 10:50 market
    const abstain = await c.query(`
      SELECT split_part(COALESCE(last_abstain_reason,'none'),':',1) r, COUNT(*)::int n
      FROM algo_price_ticks
      WHERE condition_id='0x20af38b77be70bd48f1b42080c45aeecc122f5b19705e8cec132c5cd77d2c27c'
        AND recorded_at >= '2026-07-11T14:50:00Z'
      GROUP BY 1 ORDER BY n DESC`);
    console.log('BTC abstain', abstain.rows);

    const firstSig = await c.query(`
      SELECT recorded_at, last_signal_outcome, up_price, down_price
      FROM algo_price_ticks
      WHERE condition_id='0x20af38b77be70bd48f1b42080c45aeecc122f5b19705e8cec132c5cd77d2c27c'
        AND last_signal_outcome IS NOT NULL
        AND recorded_at >= '2026-07-11T14:50:00Z'
      ORDER BY recorded_at LIMIT 5`);
    console.log('BTC first signals', firstSig.rows);

  } finally { c.release(); await pool.end(); }
}
main().catch(e => { console.error(e); process.exit(1); });
