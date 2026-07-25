import pg from 'pg';
import { loadMonorepoEnv } from '../packages/core/src/config/env.js';

loadMonorepoEnv();

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const c = await pool.connect();
  try {
    const r = await c.query(
      `
      SELECT p.id, p.status, p.close_reason, p.outcome, p.opened_at,
             e.status AS exec_status, e.error, e.fill_price, e.fill_quantity
      FROM copied_positions p
      LEFT JOIN executions e ON e.copied_position_id = p.id AND e.side = 'BUY'
      WHERE p.reason = 'ALGO_OPEN'
      ORDER BY p.id DESC
      LIMIT 15
      `,
    );
    console.table(r.rows);
  } finally {
    c.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
