import pg from 'pg';
import { loadMonorepoEnv } from '../packages/core/src/config/env.js';

loadMonorepoEnv();
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const c = await pool.connect();
  try {
    const dup = await c.query(`
      SELECT e.order_signal_id,
             COUNT(*)::int AS exec_count,
             array_agg(e.copied_position_id ORDER BY e.id) AS pos_ids,
             array_agg(e.status ORDER BY e.id) AS statuses
      FROM executions e
      JOIN copied_positions p ON p.id = e.copied_position_id
      WHERE p.reason = 'ALGO_OPEN' AND p.mode = 'sim' AND e.side = 'BUY'
      GROUP BY e.order_signal_id
      HAVING COUNT(DISTINCT e.copied_position_id) > 1
      ORDER BY MAX(e.id) DESC
      LIMIT 10
    `);
    console.log('DUPLICATE SIGNAL IDS', JSON.stringify(dup.rows, null, 2));

    const timeline = await c.query(`
      SELECT p.id, p.status, p.close_reason, p.outcome,
             e.id AS exec_id, e.status AS exec_status, e.error, e.order_signal_id
      FROM copied_positions p
      LEFT JOIN executions e ON e.copied_position_id = p.id AND e.side = 'BUY'
      WHERE p.id BETWEEN 21680 AND 21690
      ORDER BY p.id
    `);
    console.log('TIMELINE', JSON.stringify(timeline.rows, null, 2));
  } finally {
    c.release();
    await pool.end();
  }
}

main();
