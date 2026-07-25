import pg from 'pg';
import { loadMonorepoEnv } from '../packages/core/src/config/env.js';

loadMonorepoEnv();

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const ids = [21718, 21721, 21722, 21723, 21725, 21728, 21729, 21736, 21737];

async function main() {
  const c = await pool.connect();
  try {
    const r = await c.query(
      `
      SELECT p.id, p.status, p.close_reason, p.outcome, p.opened_at,
             e.id AS exec_id, e.status AS exec_status, e.error, e.side,
             e.order_signal_id,
             r.created_at AS resv_at, r.expires_at
      FROM copied_positions p
      LEFT JOIN executions e ON e.copied_position_id = p.id
      LEFT JOIN position_reservations r ON r.copied_position_id = p.id
      WHERE p.id = ANY($1)
      ORDER BY p.id, e.id
      `,
      [ids],
    );
    console.log(JSON.stringify(r.rows, null, 2));
  } finally {
    c.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
