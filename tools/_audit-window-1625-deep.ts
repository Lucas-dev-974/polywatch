/**
 * Deep dive 16:25 window — reconstruct slippage from ticks + orphan timing.
 */
import pg from 'pg';
import { loadMonorepoEnv } from '../packages/core/src/config/env.js';

loadMonorepoEnv();

const POS_IDS = [24409, 24410, 24411, 24412, 24413, 24414, 24415];

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const j = (v: unknown) => JSON.stringify(v, null, 2);

async function main() {
  const c = await pool.connect();
  try {
    await c.query(`SET TIME ZONE 'UTC'`);

    const rows = (
      await c.query(
        `
      SELECT p.id AS pos_id, p.condition_id, p.outcome, p.status, p.close_reason,
             s.crypto_symbol,
             e.id AS exec_id, e.status AS exec_status, e.error, e.side, e.reason AS exec_reason,
             e.fill_price, e.reference_vwap, e.requested_qty,
             e.order_signal_id, e.executed_at::text AS executed_at
      FROM copied_positions p
      JOIN algo_surveillance_snapshots s ON s.condition_id = p.condition_id
      LEFT JOIN executions e ON e.copied_position_id = p.id
      WHERE p.id = ANY($1)
        AND s.id = ANY($2)
      ORDER BY p.id, e.id
    `,
        [POS_IDS, [11325, 11326, 11327, 11328]],
      )
    ).rows;

    console.log('=== POS+EXEC ===');
    console.log(j(rows));

    const maxSlip = Number(
      (
        await c.query(
          `SELECT max_slippage_percent FROM risk_config ORDER BY id LIMIT 1`,
        )
      ).rows[0]?.max_slippage_percent ?? 2,
    );
    console.log('\nmax_slippage_percent=', maxSlip);

    // For each failed BUY: nearest ticks around reference era (window open + first minutes)
    for (const posId of POS_IDS) {
      const pos = rows.find((r) => Number(r.pos_id) === posId);
      if (!pos) continue;
      const buy = rows.find(
        (r) => Number(r.pos_id) === posId && r.side === 'BUY',
      );
      if (!buy) continue;

      console.log(`\n===== ${pos.crypto_symbol} pos=#${posId} error=${buy.error} =====`);

      // ticks when up_ask / up_price diverge from reference_vwap
      const ticks = (
        await c.query(
          `
        SELECT recorded_at::text AS at,
               up_price, up_bid, up_ask, down_price, down_bid, down_ask,
               last_signal_outcome, last_abstain_reason,
               ROUND((ABS(up_ask - $2::float8) / NULLIF($2::float8,0) * 100)::numeric, 4) AS ask_slip_vs_ref_pct,
               ROUND((ABS(up_price - $2::float8) / NULLIF($2::float8,0) * 100)::numeric, 4) AS mid_slip_vs_ref_pct
        FROM algo_price_ticks
        WHERE condition_id = $1
          AND recorded_at BETWEEN TIMESTAMP '2026-07-13 14:25:00'
                              AND TIMESTAMP '2026-07-13 14:32:00'
        ORDER BY recorded_at
        LIMIT 40
      `,
          [pos.condition_id, buy.reference_vwap ?? 0],
        )
      ).rows;

      // Also try local wall-clock stored as 16:25
      const ticksLocal = (
        await c.query(
          `
        SELECT recorded_at::text AS at,
               up_price, up_bid, up_ask,
               last_signal_outcome,
               ROUND((ABS(up_ask - $2::float8) / NULLIF($2::float8,0) * 100)::numeric, 4) AS ask_slip_vs_ref_pct
        FROM algo_price_ticks
        WHERE condition_id = $1
          AND recorded_at BETWEEN TIMESTAMP '2026-07-13 16:25:00'
                              AND TIMESTAMP '2026-07-13 16:32:00'
        ORDER BY recorded_at
        LIMIT 40
      `,
          [pos.condition_id, buy.reference_vwap ?? 0],
        )
      ).rows;

      console.log(`ticks UTC14:25 count=${ticks.length} local16:25 count=${ticksLocal.length}`);
      const use = ticksLocal.length ? ticksLocal : ticks;
      const signalTicks = use.filter((t) => t.last_signal_outcome != null);
      console.log('signal ticks:', j(signalTicks.slice(0, 8)));
      const highSlip = use.filter(
        (t) => t.ask_slip_vs_ref_pct != null && Number(t.ask_slip_vs_ref_pct) > maxSlip,
      );
      console.log(
        `ticks with ask slip > ${maxSlip}% vs ref=${buy.reference_vwap}: ${highSlip.length}/${use.length}`,
      );
      if (highSlip[0]) console.log('first high-slip tick:', j(highSlip[0]));
      if (use[0]) console.log('first tick:', j(use[0]));
      if (use.length) console.log('last tick sample:', j(use[use.length - 1]));
    }

    // Cluster: are orphan exec ids consecutive? (burst)
    const orphans = rows.filter((r) => r.error === 'placing_orphan');
    console.log('\n=== ORPHAN CLUSTER ===');
    console.log(
      j(
        orphans.map((o) => ({
          pos: o.pos_id,
          symbol: o.crypto_symbol,
          exec: o.exec_id,
          signal: o.order_signal_id,
          ref: o.reference_vwap,
        })),
      ),
    );

    // Nearby successful vs failed in same second window
    const nearbyExecs = (
      await c.query(
        `
      SELECT e.id, e.copied_position_id, e.status, e.error, e.reason, e.side,
             e.executed_at::text, e.reference_vwap, e.fill_price
      FROM executions e
      WHERE e.id BETWEEN 79240 AND 79255
      ORDER BY e.id
    `,
      )
    ).rows;
    console.log('\n=== EXEC ID NEIGHBORHOOD 79240-79255 ===');
    console.log(j(nearbyExecs));
  } finally {
    c.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
