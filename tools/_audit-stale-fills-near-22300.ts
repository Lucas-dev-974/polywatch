import pg from 'pg';
import { loadMonorepoEnv } from '../packages/core/src/config/env.js';

loadMonorepoEnv();

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const j = (v: unknown) => JSON.stringify(v, null, 2);

async function auditPos(c: pg.PoolClient, id: number) {
  const pos = (
    await c.query(
      `
    SELECT id, condition_id, outcome, entry_price, entry_bid_vwap,
           opened_at::text, status
    FROM copied_positions WHERE id = $1
  `,
      [id],
    )
  ).rows[0];
  if (!pos) return;

  const near = (
    await c.query(
      `
    SELECT recorded_at::text, up_price, up_bid, up_ask, up_ask_vwap,
           ROUND(EXTRACT(EPOCH FROM (recorded_at - $2::timestamp))::numeric, 2) AS sec
    FROM algo_price_ticks
    WHERE condition_id = $1
    ORDER BY ABS(EXTRACT(EPOCH FROM (recorded_at - $2::timestamp)))
    LIMIT 2
  `,
      [pos.condition_id, pos.opened_at],
    )
  ).rows;

  const match = (
    await c.query(
      `
    SELECT recorded_at::text, up_price, up_bid, up_ask, up_ask_vwap,
           ROUND(EXTRACT(EPOCH FROM ($2::timestamp - recorded_at))::numeric, 2) AS sec_before
    FROM algo_price_ticks
    WHERE condition_id = $1 AND recorded_at <= $2::timestamp AND up_bid IS NOT NULL
    ORDER BY ABS(up_bid - $3), recorded_at DESC
    LIMIT 2
  `,
      [pos.condition_id, pos.opened_at, pos.entry_bid_vwap],
    )
  ).rows;

  console.log(`\n=== #${id} ===`);
  console.log(j({ pos, near_open: near, match_entry_bid: match }));
}

async function main() {
  const c = await pool.connect();
  try {
    await c.query(`SET TIME ZONE 'UTC'`);
    for (const id of [22299, 22300, 22304, 22306]) {
      await auditPos(c, id);
    }

    // Same condition as 22300?
    console.log('\n=== condition ids ===');
    console.log(
      j(
        (
          await c.query(`
      SELECT id, LEFT(condition_id, 18) AS cid, outcome, entry_price, entry_bid_vwap, opened_at::text
      FROM copied_positions WHERE id IN (22299,22300,22304,22306)
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
