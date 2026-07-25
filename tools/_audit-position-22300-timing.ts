import pg from 'pg';
import { loadMonorepoEnv } from '../packages/core/src/config/env.js';

loadMonorepoEnv();

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const j = (v: unknown) => JSON.stringify(v, null, 2);

async function main() {
  const c = await pool.connect();
  try {
    await c.query(`SET TIME ZONE 'UTC'`);

    console.log('=== EXECUTION 75935 full row ===');
    console.log(
      j(
        (
          await c.query(`
      SELECT * FROM executions WHERE id = 75935
    `)
        ).rows,
      ),
    );

    console.log('\n=== POSITION 22300 columns with any time ===');
    console.log(
      j(
        (
          await c.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'copied_positions'
        AND (column_name ILIKE '%at%' OR column_name ILIKE '%time%' OR column_name ILIKE '%date%')
      ORDER BY ordinal_position
    `)
        ).rows,
      ),
    );

    // Nearby positions timing — same window — to see if many opens clustered late
    console.log('\n=== NEARBY ALGO SIM OPENS (id window) ===');
    console.log(
      j(
        (
          await c.query(`
      SELECT id, opened_at::text, entry_price, entry_bid_vwap, status, outcome
      FROM copied_positions
      WHERE id BETWEEN 22290 AND 22310
        AND reason = 'ALGO_OPEN'
      ORDER BY id
    `)
        ).rows,
      ),
    );

    // How long between reservation-like pending and open — check if pending positions keep something
    console.log('\n=== exec placing→filled gap via id sequence around that second ===');
    console.log(
      j(
        (
          await c.query(`
      SELECT id, copied_position_id, reason, status, fill_price, reference_vwap,
             executed_at::text
      FROM executions
      WHERE id BETWEEN 75920 AND 75945
      ORDER BY id
    `)
        ).rows,
      ),
    );
  } finally {
    c.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
