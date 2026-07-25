/**
 * Deep-dive follow-up for crypto-algo SIM optimization.
 * Usage: npx tsx tools/_audit-crypto-algo-sim-optimize-deep.ts
 */
import pg from 'pg';
import { loadMonorepoEnv } from '../packages/core/src/config/env.js';

loadMonorepoEnv();

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const j = (v: unknown) => JSON.stringify(v, null, 2);

async function main() {
  const c = await pool.connect();
  try {
    console.log('=== TICK COVERAGE ===');
    console.log(
      j(
        (
          await c.query(`
      SELECT
        COUNT(*) FILTER (WHERE status='closed')::int AS closed,
        COUNT(*) FILTER (WHERE status='closed' AND tick_n > 0)::int AS closed_with_ticks,
        COUNT(*) FILTER (WHERE status='closed' AND tick_n = 0)::int AS closed_no_ticks,
        ROUND(AVG(tick_n) FILTER (WHERE status='closed' AND tick_n > 0),1) AS avg_ticks_when_present
      FROM (
        SELECT p.id, p.status, COUNT(t.*)::int AS tick_n
        FROM copied_positions p
        LEFT JOIN market_position_ticks t ON t.copied_position_id = p.id
        WHERE p.mode='sim' AND p.reason='ALGO_OPEN'
        GROUP BY p.id, p.status
      ) s
    `)
        ).rows[0],
      ),
    );

    console.log('\n=== SL: peak buckets ===');
    console.table(
      (
        await c.query(`
      SELECT
        CASE
          WHEN peak_closure_pnl_percent IS NULL THEN 'null'
          WHEN peak_closure_pnl_percent < 0 THEN 'peak_<0'
          WHEN peak_closure_pnl_percent < 10 THEN 'peak_0-10'
          WHEN peak_closure_pnl_percent < 30 THEN 'peak_10-30'
          WHEN peak_closure_pnl_percent < 50 THEN 'peak_30-50'
          ELSE 'peak_>=50'
        END AS peak_bucket,
        COUNT(*)::int AS n,
        ROUND(SUM(realized_pnl)::numeric,2) AS sum_pnl,
        ROUND(AVG(realized_pnl)::numeric,3) AS avg_pnl
      FROM copied_positions
      WHERE mode='sim' AND reason='ALGO_OPEN' AND status='closed' AND close_reason='SL'
      GROUP BY 1 ORDER BY 1
    `)
      ).rows,
    );

    console.log('\n=== SL WHIPSAW peak>=30 ===');
    console.log(
      j(
        (
          await c.query(`
      SELECT COUNT(*)::int AS n,
             ROUND(SUM(realized_pnl)::numeric,2) AS sum_pnl,
             ROUND(AVG(peak_closure_pnl_percent)::numeric,1) AS avg_peak
      FROM copied_positions
      WHERE mode='sim' AND reason='ALGO_OPEN' AND status='closed'
        AND close_reason='SL' AND peak_closure_pnl_percent >= 30
    `)
        ).rows[0],
      ),
    );

    console.log('\n=== BY ASSET ===');
    console.table(
      (
        await c.query(`
      SELECT
        CASE
          WHEN m.slug LIKE 'btc%' THEN 'btc'
          WHEN m.slug LIKE 'eth%' THEN 'eth'
          WHEN m.slug LIKE 'sol%' THEN 'sol'
          WHEN m.slug LIKE 'xrp%' THEN 'xrp'
          ELSE 'other'
        END AS asset,
        COUNT(*) FILTER (WHERE p.status='closed')::int AS closed,
        ROUND(SUM(p.realized_pnl) FILTER (WHERE p.status='closed')::numeric,2) AS pnl,
        COUNT(*) FILTER (WHERE p.status='closed' AND p.close_reason='SL')::int AS sl_n,
        COUNT(*) FILTER (WHERE p.status='closed' AND p.close_reason='REDEMPTION' AND p.realized_pnl>0)::int AS red_wins,
        COUNT(*) FILTER (WHERE p.status='closed' AND p.close_reason='REDEMPTION' AND p.realized_pnl<=0)::int AS red_loss
      FROM copied_positions p
      LEFT JOIN markets m ON m.condition_id = p.condition_id
      WHERE p.mode='sim' AND p.reason='ALGO_OPEN'
      GROUP BY 1 ORDER BY pnl
    `)
      ).rows,
    );

    console.log('\n=== REDEMPTION LOSS with SL breach ticks ===');
    console.log(
      j(
        (
          await c.query(`
      WITH pos AS (
        SELECT p.id, p.realized_pnl, p.entry_bid_vwap, p.entry_price, p.sl_bid_points, p.opened_at, p.closed_at
        FROM copied_positions p
        WHERE p.mode='sim' AND p.reason='ALGO_OPEN' AND p.status='closed'
          AND p.close_reason='REDEMPTION' AND p.realized_pnl < 0
          AND COALESCE(p.entry_bid_vwap, p.entry_price) > 0
          AND p.sl_bid_points > 0
      )
      SELECT COUNT(*)::int AS red_loss_n,
             COUNT(*) FILTER (WHERE breach_n > 0)::int AS with_sl_breach,
             ROUND(SUM(realized_pnl) FILTER (WHERE breach_n > 0)::numeric,2) AS pnl_breach,
             ROUND(SUM(realized_pnl)::numeric,2) AS pnl_all_red_loss
      FROM (
        SELECT pos.*, (
          SELECT COUNT(*)::int FROM market_position_ticks t
          WHERE t.copied_position_id = pos.id
            AND t.executable_bid_vwap > 0
            AND t.executable_bid_vwap <= (COALESCE(pos.entry_bid_vwap, pos.entry_price) - pos.sl_bid_points)
            AND t.created_at BETWEEN pos.opened_at AND pos.closed_at
        ) AS breach_n
        FROM pos
      ) x
    `)
        ).rows[0],
      ),
    );

    console.log('\n=== ENTRY vs OUTCOME ===');
    console.table(
      (
        await c.query(`
      SELECT
        CASE
          WHEN entry_price < 0.55 THEN 'a_<0.55'
          WHEN entry_price < 0.60 THEN 'b_0.55-0.60'
          WHEN entry_price < 0.65 THEN 'c_0.60-0.65'
          WHEN entry_price < 0.70 THEN 'd_0.65-0.70'
          ELSE 'e_>=0.70'
        END AS bucket,
        COUNT(*)::int AS n,
        ROUND(100.0*COUNT(*) FILTER (WHERE close_reason='SL')/COUNT(*),1) AS sl_pct,
        ROUND(100.0*COUNT(*) FILTER (WHERE close_reason='REDEMPTION' AND realized_pnl>0)/COUNT(*),1) AS red_win_pct,
        ROUND(SUM(realized_pnl)::numeric,2) AS pnl
      FROM copied_positions
      WHERE mode='sim' AND reason='ALGO_OPEN' AND status='closed' AND entry_price > 0
      GROUP BY 1 ORDER BY 1
    `)
      ).rows,
    );

    console.log('\n=== EXIT BLOCKS IMPACT (positions with blocks then REDEMPTION loss) ===');
    console.log(
      j(
        (
          await c.query(`
      SELECT COUNT(*)::int AS n,
             ROUND(SUM(realized_pnl)::numeric,2) AS sum_pnl
      FROM copied_positions
      WHERE mode='sim' AND reason='ALGO_OPEN' AND status='closed'
        AND close_reason='REDEMPTION' AND realized_pnl < 0
        AND exit_emit_blocked_count > 0
    `)
        ).rows[0],
      ),
    );

    // Counterfactual rough: if SL whipsaw (peak>=30) had held to avg redemption win
    console.log('\n=== COUNTERFACTUAL NOTES ===');
    const whip = (
      await c.query(`
      SELECT COUNT(*)::int AS n, ROUND(SUM(realized_pnl)::numeric,2) AS sum_pnl
      FROM copied_positions
      WHERE mode='sim' AND reason='ALGO_OPEN' AND status='closed'
        AND close_reason='SL' AND COALESCE(peak_closure_pnl_percent,0) >= 30
    `)
    ).rows[0];
    const avgRedWin = (
      await c.query(`
      SELECT ROUND(AVG(realized_pnl)::numeric,3) AS avg_win
      FROM copied_positions
      WHERE mode='sim' AND reason='ALGO_OPEN' AND status='closed'
        AND close_reason='REDEMPTION' AND realized_pnl > 0
    `)
    ).rows[0];
    console.log('SL whipsaw peak>=30:', whip);
    console.log('Avg redemption win:', avgRedWin);
    console.log(
      'If those SL whipsaws became avg redemption wins instead:',
      Number(whip.n) * Number(avgRedWin.avg_win) - Number(whip.sum_pnl),
      'USD swing vs current',
    );

    // Trailing opportunity: peak high then SL
    console.log('\n=== TRAILING OPPORTUNITY (SL with peak>=20) ===');
    console.log(
      j(
        (
          await c.query(`
      SELECT COUNT(*)::int AS n,
             ROUND(SUM(realized_pnl)::numeric,2) AS actual_pnl,
             ROUND(AVG(peak_closure_pnl_percent)::numeric,1) AS avg_peak,
             ROUND(AVG(entry_price)::numeric,3) AS avg_entry
      FROM copied_positions
      WHERE mode='sim' AND reason='ALGO_OPEN' AND status='closed'
        AND close_reason='SL' AND peak_closure_pnl_percent >= 20
    `)
        ).rows[0],
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
