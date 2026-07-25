import pg from 'pg';
import { loadMonorepoEnv } from '../packages/core/src/config/env.js';

loadMonorepoEnv();

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const c = await pool.connect();
  try {
    const byError = await c.query(`
      SELECT status, error, COUNT(*)::int AS n
      FROM executions
      WHERE mode = 'sim' AND reason = 'ALGO_OPEN' AND id > 75256
      GROUP BY status, error ORDER BY n DESC
    `);
    console.log('OUTCOMES SINCE FIX', JSON.stringify(byError.rows, null, 1));

    const filled = await c.query(`
      SELECT e.id, e.copied_position_id, e.status, e.filled_qty, e.avg_fill_price,
             p.status AS pos_status
      FROM executions e
      JOIN copied_positions p ON p.id = e.copied_position_id
      WHERE e.mode = 'sim' AND e.reason = 'ALGO_OPEN' AND e.status = 'filled' AND e.id > 75256
      ORDER BY e.id DESC LIMIT 8
    `);
    console.log('FILLED SINCE FIX', JSON.stringify(filled.rows, null, 1));

    const stuck = await c.query(`
      SELECT COUNT(*)::int AS n FROM copied_positions
      WHERE status = 'pending' AND mode = 'sim'
    `);
    console.log('STILL PENDING', JSON.stringify(stuck.rows[0]));
  } finally {
    c.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
