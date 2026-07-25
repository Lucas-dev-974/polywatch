import pg from 'pg';
import { loadMonorepoEnv } from '../packages/core/src/config/env.js';

loadMonorepoEnv();

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const c = await pool.connect();
  try {
    const ids = [21798, 21800, 21804, 21810, 21812, 21814, 21817, 21818, 21819, 21821, 21822, 21823, 21825];
    const r = await c.query(
      `
      SELECT p.id, p.status, p.close_reason, p.outcome, p.opened_at, p.closed_at,
             e.id AS exec_id, e.status AS exec_status, e.error, e.side,
             e.executed_at AS exec_at, e.order_signal_id
      FROM copied_positions p
      LEFT JOIN executions e ON e.copied_position_id = p.id
      WHERE p.id = ANY($1)
      ORDER BY p.id, e.id
      `,
      [ids],
    );
    console.log('=== POSITIONS + EXECUTIONS ===');
    console.log(JSON.stringify(r.rows, null, 2));

    const r2 = await c.query(
      `
      SELECT r.id, r.copied_position_id, r.reason, r.order_signal_id,
             r.created_at, r.expires_at
      FROM position_reservations r
      WHERE r.copied_position_id = ANY($1)
      ORDER BY r.copied_position_id
      `,
      [ids],
    );
    console.log('=== RESERVATIONS ===');
    console.log(JSON.stringify(r2.rows, null, 2));
  } finally {
    c.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
