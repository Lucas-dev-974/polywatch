import pg from 'pg';
import { loadMonorepoEnv } from '../packages/core/src/config/env.js';

loadMonorepoEnv();

/**
 * Root-cause probe: for fills around the incident, compare
 * entry/fill vs live tick at opened_at vs best historical match.
 * Also check whether ALGO_OPEN is slippage-guarded (code) and
 * how many executions finalized in the same second burst.
 */
async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const c = await pool.connect();
  try {
    await c.query(`SET TIME ZONE 'UTC'`);

    console.log('=== FINALIZE BURST 11:21:40–11:22:00 ===');
    const burst = (
      await c.query(`
      SELECT e.id, e.copied_position_id AS pos, e.reason, e.side, e.status,
             e.fill_price, e.reference_vwap, e.executed_at::text,
             p.outcome, p.entry_bid_vwap,
             LEFT(p.condition_id, 10) AS cid
      FROM executions e
      JOIN copied_positions p ON p.id = e.copied_position_id
      WHERE e.executed_at BETWEEN '2026-07-12 11:21:40' AND '2026-07-12 11:22:00'
      ORDER BY e.executed_at, e.id
    `)
    ).rows;
    console.log(JSON.stringify(burst, null, 2));

    console.log('\n=== For each ALGO_OPEN fill in burst: live mid vs entry ===');
    for (const row of burst) {
      if (row.reason !== 'ALGO_OPEN' || row.status !== 'filled') continue;
      const live = (
        await c.query(
          `
        SELECT recorded_at::text, up_price, up_bid, up_ask, down_price, down_bid, down_ask,
               ROUND(EXTRACT(EPOCH FROM (recorded_at - $2::timestamp))::numeric, 2) AS sec
        FROM algo_price_ticks
        WHERE condition_id = (SELECT condition_id FROM copied_positions WHERE id = $1)
        ORDER BY ABS(EXTRACT(EPOCH FROM (recorded_at - $2::timestamp)))
        LIMIT 1
      `,
          [row.pos, row.executed_at],
        )
      ).rows[0];

      const outcome = row.outcome as string;
      const isUp = outcome === 'YES' || outcome === 'Up' || outcome === 'up';
      const liveBid = isUp ? live?.up_bid : live?.down_bid;
      const liveAsk = isUp ? live?.up_ask : live?.down_ask;
      const liveMid = isUp ? live?.up_price : live?.down_price;
      const entry = Number(row.entry_bid_vwap);
      const fill = Number(row.fill_price);
      const deltaBid = liveBid != null ? Math.abs(Number(liveBid) - entry) : null;

      // best historical match for entry bid on that leg
      const hist = (
        await c.query(
          `
        WITH o AS (
          SELECT condition_id, opened_at, entry_bid_vwap, outcome
          FROM copied_positions WHERE id = $1
        )
        SELECT t.recorded_at::text,
               CASE WHEN o.outcome IN ('YES','Up','up') THEN t.up_bid ELSE t.down_bid END AS leg_bid,
               CASE WHEN o.outcome IN ('YES','Up','up') THEN t.up_ask ELSE t.down_ask END AS leg_ask,
               ROUND(EXTRACT(EPOCH FROM (o.opened_at - t.recorded_at))::numeric, 2) AS sec_before
        FROM algo_price_ticks t CROSS JOIN o
        WHERE t.condition_id = o.condition_id
          AND t.recorded_at <= o.opened_at
        ORDER BY ABS(
          CASE WHEN o.outcome IN ('YES','Up','up') THEN t.up_bid ELSE t.down_bid END
          - o.entry_bid_vwap
        ), t.recorded_at DESC
        LIMIT 1
      `,
          [row.pos],
        )
      ).rows[0];

      console.log(
        JSON.stringify(
          {
            pos: row.pos,
            outcome,
            fill,
            entry,
            liveMid,
            liveBid,
            liveAsk,
            deltaEntryVsLiveBid: deltaBid,
            histMatch: hist,
            stale:
              deltaBid != null &&
              deltaBid > 0.15 &&
              hist &&
              Number(hist.sec_before) > 30,
          },
          null,
          2,
        ),
      );
    }

    console.log('\n=== Failed ALGO_OPEN in same window (claim without fill time) ===');
    console.log(
      JSON.stringify(
        (
          await c.query(`
      SELECT e.id, e.copied_position_id, e.status, e.error, e.reference_vwap
      FROM executions e
      WHERE e.id BETWEEN 75927 AND 75945 AND e.reason = 'ALGO_OPEN' AND e.status = 'failed'
      ORDER BY e.id
    `)
        ).rows,
        null,
        2,
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
