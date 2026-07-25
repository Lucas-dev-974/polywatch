import pg from 'pg';
import { loadMonorepoEnv } from '../packages/core/src/config/env.js';

loadMonorepoEnv();

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const j = (v: unknown) => JSON.stringify(v, null, 2);

async function main() {
  const c = await pool.connect();
  try {
    // Force UTC and compare naive timestamps only (both columns are timestamp without tz)
    await c.query(`SET TIME ZONE 'UTC'`);

    console.log('=== OPEN + EXEC ===');
    console.log(
      j(
        (
          await c.query(`
      SELECT p.opened_at::text AS opened_at,
             e.executed_at::text AS executed_at,
             e.fill_price, e.reference_vwap, e.fill_quantity,
             p.entry_price, p.entry_bid_vwap
      FROM copied_positions p
      JOIN executions e ON e.copied_position_id = p.id AND e.reason = 'ALGO_OPEN'
      WHERE p.id = 22300
    `)
        ).rows,
      ),
    );

    console.log('\n=== TICKS ±90s AROUND OPEN (naive compare) ===');
    const ticks = (
      await c.query(`
      WITH o AS (
        SELECT opened_at, condition_id, entry_bid_vwap, entry_price
        FROM copied_positions WHERE id = 22300
      )
      SELECT t.recorded_at::text AS recorded_at,
             t.up_price, t.up_bid, t.up_ask, t.up_ask_vwap, t.book_staleness_ms,
             ROUND(EXTRACT(EPOCH FROM (t.recorded_at - o.opened_at))::numeric, 2) AS sec_from_open
      FROM algo_price_ticks t
      CROSS JOIN o
      WHERE t.condition_id = o.condition_id
        AND t.recorded_at BETWEEN o.opened_at - interval '90 seconds'
                              AND o.opened_at + interval '20 seconds'
      ORDER BY t.recorded_at
    `)
    ).rows;
    console.log('count', ticks.length);

    // sample ~every 3s + edges + near zero
    const sampled = ticks.filter((row, i) => {
      const sec = Number(row.sec_from_open);
      return (
        i === 0 ||
        i === ticks.length - 1 ||
        Math.abs(sec) < 1.2 ||
        i % Math.max(1, Math.floor(ticks.length / 35)) === 0
      );
    });
    console.log(j(sampled));

    console.log('\n=== LAST up>=0.50 BEFORE OPEN ===');
    console.log(
      j(
        (
          await c.query(`
      WITH o AS (SELECT opened_at, condition_id FROM copied_positions WHERE id = 22300)
      SELECT t.recorded_at::text, t.up_price, t.up_bid, t.up_ask, t.up_ask_vwap,
             ROUND(EXTRACT(EPOCH FROM (o.opened_at - t.recorded_at))::numeric, 2) AS sec_before_open
      FROM algo_price_ticks t CROSS JOIN o
      WHERE t.condition_id = o.condition_id
        AND t.recorded_at <= o.opened_at
        AND t.up_price >= 0.50
      ORDER BY t.recorded_at DESC
      LIMIT 5
    `)
        ).rows,
      ),
    );

    console.log('\n=== FIRST up<=0.20 BEFORE OPEN ===');
    console.log(
      j(
        (
          await c.query(`
      WITH o AS (SELECT opened_at, condition_id FROM copied_positions WHERE id = 22300)
      SELECT t.recorded_at::text, t.up_price, t.up_bid, t.up_ask, t.up_ask_vwap,
             ROUND(EXTRACT(EPOCH FROM (o.opened_at - t.recorded_at))::numeric, 2) AS sec_before_open
      FROM algo_price_ticks t CROSS JOIN o
      WHERE t.condition_id = o.condition_id
        AND t.recorded_at <= o.opened_at
        AND t.up_price IS NOT NULL AND t.up_price <= 0.20
      ORDER BY t.recorded_at ASC
      LIMIT 5
    `)
        ).rows,
      ),
    );

    console.log('\n=== NEAREST TICK AT OPEN + MATCH entry 0.57/0.58 ===');
    console.log(
      j(
        (
          await c.query(`
      WITH o AS (SELECT opened_at, condition_id, entry_bid_vwap, entry_price FROM copied_positions WHERE id = 22300)
      SELECT t.recorded_at::text, t.up_price, t.up_bid, t.up_ask, t.up_ask_vwap,
             ROUND(EXTRACT(EPOCH FROM (t.recorded_at - o.opened_at))::numeric, 2) AS sec_from_open,
             ABS(t.up_bid - o.entry_bid_vwap) AS bid_err,
             ABS(COALESCE(t.up_ask_vwap, t.up_ask) - o.entry_price) AS ask_err
      FROM algo_price_ticks t CROSS JOIN o
      WHERE t.condition_id = o.condition_id
      ORDER BY ABS(EXTRACT(EPOCH FROM (t.recorded_at - o.opened_at)))
      LIMIT 3
    `)
        ).rows,
      ),
    );
    console.log(
      j(
        (
          await c.query(`
      WITH o AS (SELECT opened_at, condition_id, entry_bid_vwap FROM copied_positions WHERE id = 22300)
      SELECT t.recorded_at::text, t.up_price, t.up_bid, t.up_ask, t.up_ask_vwap,
             ROUND(EXTRACT(EPOCH FROM (o.opened_at - t.recorded_at))::numeric, 2) AS sec_before_open
      FROM algo_price_ticks t CROSS JOIN o
      WHERE t.condition_id = o.condition_id
        AND t.recorded_at <= o.opened_at
        AND t.up_bid IS NOT NULL
      ORDER BY ABS(t.up_bid - o.entry_bid_vwap), t.recorded_at DESC
      LIMIT 5
    `)
        ).rows,
      ),
    );

    console.log('\n=== CRASH TIMELINE (when up drops) ===');
    console.log(
      j(
        (
          await c.query(`
      WITH o AS (SELECT opened_at, condition_id FROM copied_positions WHERE id = 22300),
      ordered AS (
        SELECT t.recorded_at, t.up_price, t.up_bid, t.up_ask, t.up_ask_vwap,
               LAG(t.up_price) OVER (ORDER BY t.recorded_at) AS prev_up
        FROM algo_price_ticks t CROSS JOIN o
        WHERE t.condition_id = o.condition_id
      )
      SELECT recorded_at::text, up_price, prev_up, up_bid, up_ask, up_ask_vwap,
             ROUND(EXTRACT(EPOCH FROM (recorded_at - (SELECT opened_at FROM o)))::numeric, 2) AS sec_from_open
      FROM ordered
      WHERE prev_up IS NOT NULL AND up_price IS NOT NULL
        AND (prev_up - up_price) >= 0.05
      ORDER BY recorded_at
      LIMIT 20
    `)
        ).rows,
      ),
    );

    // First SL exit attempt mark_bid at open+18ms
    console.log('\n=== SL attempt at open+18ms mark_bid=0.14 vs fill 0.58 ===');
    console.log(
      j(
        (
          await c.query(`
      SELECT created_at::text, kind, close_reason, block_reason, mark_bid, error
      FROM exit_attempt_events
      WHERE copied_position_id = 22300
      ORDER BY id
      LIMIT 3
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
