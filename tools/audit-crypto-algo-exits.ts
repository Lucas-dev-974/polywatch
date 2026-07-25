import pg from 'pg';
import { loadMonorepoEnv } from '../packages/core/src/config/env.js';

loadMonorepoEnv();

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

interface ClosedPositionRow {
  id: number;
  condition_id: string;
  outcome: string;
  status: string;
  entry_price: number;
  entry_bid_vwap: number;
  quantity: number;
  entry_fees_remaining: number;
  entry_quantity_remaining: number | null;
  sl_percent: number | null;
  tp_percent: number | null;
  trailing_stop_percent: number | null;
  realized_pnl: number;
  peak_closure_pnl_percent: number | null;
  opened_at: Date;
  closed_at: Date;
  close_reason: string | null;
  duration_sec: number;
  slug: string | null;
  end_date: Date | null;
  resolved: boolean | null;
  winning_token_id: string | null;
}

async function main() {
  const client = await pool.connect();

  try {
    const riskRes = await client.query(`
      SELECT crypto_algo_enabled, crypto_algo_sl_percent, crypto_algo_tp_percent,
             crypto_algo_trailing_stop_percent, crypto_algo_pre_close_enabled,
             crypto_algo_pre_close_seconds, crypto_algo_pre_close_hold_if_winning,
             sim_sl_tp_enabled, sim_sl_percent, sim_tp_percent,
             sim_pre_close_enabled, sim_pre_close_seconds, sim_pre_close_hold_if_winning
      FROM risk_config LIMIT 1
    `);
    console.log('=== RISK CONFIG (crypto algo + sim exits) ===');
    console.log(JSON.stringify(riskRes.rows[0], null, 2));

    const counts = await client.query(`
      SELECT status, close_reason, COUNT(*)::int AS cnt
      FROM copied_positions
      WHERE mode = 'sim' AND reason = 'ALGO_OPEN'
      GROUP BY status, close_reason
      ORDER BY status, close_reason
    `);
    console.log('\n=== SIM ALGO POSITIONS BY STATUS / CLOSE_REASON ===');
    console.table(counts.rows);

    const total = await client.query(`
      SELECT COUNT(*)::int AS cnt FROM copied_positions WHERE mode='sim' AND reason='ALGO_OPEN'
    `);
    console.log('Total sim ALGO positions:', total.rows[0].cnt);

    const closed = await client.query<ClosedPositionRow>(`
      SELECT p.id, p.condition_id, p.outcome, p.status, p.entry_price, p.entry_bid_vwap,
             p.quantity, p.entry_fees_remaining, p.entry_quantity_remaining,
             p.sl_percent, p.tp_percent, p.trailing_stop_percent,
             p.realized_pnl, p.peak_closure_pnl_percent,
             p.opened_at, p.closed_at, p.close_reason,
             EXTRACT(EPOCH FROM (p.closed_at - p.opened_at))::int AS duration_sec,
             m.slug, m.end_date, m.resolved, m.winning_token_id
      FROM copied_positions p
      LEFT JOIN markets m ON m.condition_id = p.condition_id
      WHERE p.mode = 'sim' AND p.reason = 'ALGO_OPEN' AND p.status = 'closed'
      ORDER BY p.closed_at DESC
    `);
    console.log(`\n=== CLOSED SIM ALGO POSITIONS (${closed.rows.length}) ===`);
    for (const p of closed.rows) {
      console.log(
        JSON.stringify({
          id: p.id,
          slug: p.slug,
          close_reason: p.close_reason,
          sl: p.sl_percent,
          tp: p.tp_percent,
          entry: p.entry_price,
          realized: p.realized_pnl,
          peak: p.peak_closure_pnl_percent,
          duration_sec: p.duration_sec,
          end_date: p.end_date,
        }),
      );
    }

    const execReasons = await client.query(`
      SELECT e.reason, e.status, e.side, COUNT(*)::int AS cnt
      FROM executions e
      JOIN copied_positions p ON p.id = e.copied_position_id
      WHERE p.mode = 'sim' AND p.reason = 'ALGO_OPEN'
      GROUP BY e.reason, e.status, e.side
      ORDER BY e.side, e.reason, e.status
    `);
    console.log('\n=== EXECUTIONS BY REASON/STATUS (sim algo) ===');
    console.table(execReasons.rows);

    const failedExits = await client.query(`
      SELECT e.reason, e.error, COUNT(*)::int AS cnt
      FROM executions e
      JOIN copied_positions p ON p.id = e.copied_position_id
      WHERE p.mode = 'sim' AND p.reason = 'ALGO_OPEN'
        AND e.side = 'SELL' AND e.status = 'failed'
        AND e.reason IN ('SL','TP','TRAILING','PRE_CLOSE_LOSS','PRE_CLOSE_WIN','TIME_EXIT')
      GROUP BY e.reason, e.error
      ORDER BY cnt DESC
      LIMIT 30
    `);
    console.log('\n=== FAILED EXIT SELLS (top errors) ===');
    console.table(failedExits.rows);

    const successExits = await client.query(`
      SELECT e.reason, COUNT(*)::int AS cnt,
             ROUND(AVG(e.realized_pnl)::numeric, 4) AS avg_pnl,
             ROUND(AVG(e.fill_price)::numeric, 4) AS avg_fill
      FROM executions e
      JOIN copied_positions p ON p.id = e.copied_position_id
      WHERE p.mode = 'sim' AND p.reason = 'ALGO_OPEN'
        AND e.side = 'SELL' AND e.status = 'filled'
        AND e.reason IN ('SL','TP','TRAILING','PRE_CLOSE_LOSS','PRE_CLOSE_WIN','TIME_EXIT','REDEMPTION')
      GROUP BY e.reason
      ORDER BY cnt DESC
    `);
    console.log('\n=== SUCCESSFUL SELL EXECUTIONS BY REASON ===');
    console.table(successExits.rows);

    console.log('\n=== SL COMPLIANCE CHECK (via market_position_ticks) ===');
    const slViolations: Record<string, unknown>[] = [];
    for (const p of closed.rows) {
      if (!p.sl_percent || p.close_reason === 'SL') continue;
      const ticks = await client.query<{
        min_trigger_pnl: string | null;
        min_closure_pnl: string | null;
        tick_count: number;
      }>(
        `
        SELECT MIN(
          CASE WHEN p2.entry_bid_vwap > 0 THEN ((t.executable_bid_vwap - p2.entry_bid_vwap) / p2.entry_bid_vwap) * 100
               WHEN t.best_bid > 0 AND p2.entry_price > 0 THEN ((t.best_bid - p2.entry_price) / p2.entry_price) * 100
               ELSE NULL END
        ) AS min_trigger_pnl,
        MIN(
          CASE WHEN p2.entry_price > 0 AND t.executable_bid_vwap IS NOT NULL THEN
            ((t.executable_bid_vwap - (p2.entry_price + COALESCE(p2.entry_fees_remaining,0)/NULLIF(COALESCE(p2.entry_quantity_remaining, p2.quantity),0))) /
             (p2.entry_price + COALESCE(p2.entry_fees_remaining,0)/NULLIF(COALESCE(p2.entry_quantity_remaining, p2.quantity),0))) * 100
          ELSE NULL END
        ) AS min_closure_pnl,
        COUNT(*)::int AS tick_count
        FROM market_position_ticks t
        JOIN copied_positions p2 ON p2.id = t.copied_position_id
        WHERE t.copied_position_id = $1
          AND t.created_at BETWEEN p2.opened_at AND COALESCE(p2.closed_at, NOW())
        `,
        [p.id],
      );
      const t = ticks.rows[0];
      const minTrigger = t?.min_trigger_pnl != null ? Number(t.min_trigger_pnl) : null;
      const minClosure = t?.min_closure_pnl != null ? Number(t.min_closure_pnl) : null;
      const sl = Number(p.sl_percent);
      const slBreached =
        (minTrigger != null && minTrigger <= -sl) || (minClosure != null && minClosure <= -sl);
      if (slBreached) {
        slViolations.push({
          id: p.id,
          close_reason: p.close_reason,
          sl,
          min_trigger_pnl: minTrigger?.toFixed(2),
          min_closure_pnl: minClosure?.toFixed(2),
          peak_closure: p.peak_closure_pnl_percent,
          ticks: t?.tick_count ?? 0,
        });
      }
    }
    console.log(
      'Positions where ticks show SL breach but close_reason != SL:',
      slViolations.length,
    );
    slViolations.forEach((v) => console.log(JSON.stringify(v)));

    console.log('\n=== TP COMPLIANCE CHECK ===');
    const tpViolations: Record<string, unknown>[] = [];
    for (const p of closed.rows) {
      const tp = p.tp_percent ? Number(p.tp_percent) : null;
      if (!tp || p.close_reason === 'TP') continue;
      const ticks = await client.query<{
        max_trigger_pnl: string | null;
        max_closure_pnl: string | null;
        tick_count: number;
      }>(
        `
        SELECT MAX(
          CASE WHEN p2.entry_bid_vwap > 0 THEN ((t.executable_bid_vwap - p2.entry_bid_vwap) / p2.entry_bid_vwap) * 100 ELSE NULL END
        ) AS max_trigger_pnl,
        MAX(
          CASE WHEN p2.entry_price > 0 AND t.executable_bid_vwap IS NOT NULL THEN
            ((t.executable_bid_vwap - (p2.entry_price + COALESCE(p2.entry_fees_remaining,0)/NULLIF(COALESCE(p2.entry_quantity_remaining, p2.quantity),0))) /
             (p2.entry_price + COALESCE(p2.entry_fees_remaining,0)/NULLIF(COALESCE(p2.entry_quantity_remaining, p2.quantity),0))) * 100
          ELSE NULL END
        ) AS max_closure_pnl,
        COUNT(*)::int AS tick_count
        FROM market_position_ticks t
        JOIN copied_positions p2 ON p2.id = t.copied_position_id
        WHERE t.copied_position_id = $1
          AND t.created_at BETWEEN p2.opened_at AND COALESCE(p2.closed_at, NOW())
        `,
        [p.id],
      );
      const t = ticks.rows[0];
      const maxTrigger = t?.max_trigger_pnl != null ? Number(t.max_trigger_pnl) : null;
      const maxClosure = t?.max_closure_pnl != null ? Number(t.max_closure_pnl) : null;
      const tpBreached =
        maxTrigger != null && maxClosure != null && maxTrigger >= tp && maxClosure >= tp;
      if (tpBreached) {
        tpViolations.push({
          id: p.id,
          close_reason: p.close_reason,
          tp,
          max_trigger: maxTrigger?.toFixed(2),
          max_closure: maxClosure?.toFixed(2),
          peak_closure: p.peak_closure_pnl_percent,
          ticks: t?.tick_count ?? 0,
        });
      }
    }
    console.log(
      'Positions where BOTH trigger+closure hit TP but close_reason != TP:',
      tpViolations.length,
    );
    tpViolations.forEach((v) => console.log(JSON.stringify(v)));

    console.log('\n=== PRE-CLOSE SIGNAL ANALYSIS ===');
    const preClose = await client.query(`
      SELECT
        COUNT(*) FILTER (WHERE e.status = 'failed')::int AS failed,
        COUNT(*) FILTER (WHERE e.status = 'filled')::int AS filled,
        COUNT(*)::int AS total
      FROM executions e
      JOIN copied_positions p ON p.id = e.copied_position_id
      WHERE p.mode = 'sim' AND p.reason = 'ALGO_OPEN'
        AND e.side = 'SELL' AND e.reason IN ('PRE_CLOSE_LOSS','PRE_CLOSE_WIN')
    `);
    console.log('PRE_CLOSE sells:', preClose.rows[0]);

    const preCloseByPos = await client.query(`
      SELECT p.id, p.close_reason,
        COUNT(*) FILTER (WHERE e.status='failed' AND e.reason='PRE_CLOSE_LOSS')::int AS pre_close_failed,
        COUNT(*) FILTER (WHERE e.status='filled' AND e.reason='PRE_CLOSE_LOSS')::int AS pre_close_filled
      FROM copied_positions p
      LEFT JOIN executions e ON e.copied_position_id = p.id AND e.side='SELL' AND e.reason='PRE_CLOSE_LOSS'
      WHERE p.mode='sim' AND p.reason='ALGO_OPEN' AND p.status='closed'
      GROUP BY p.id, p.close_reason
      HAVING COUNT(e.id) > 0
      ORDER BY pre_close_failed DESC
      LIMIT 15
    `);
    console.log('Positions with PRE_CLOSE_LOSS attempts (top 15):');
    console.table(preCloseByPos.rows);

    const open = await client.query(`
      SELECT cp.id, m.slug, cp.entry_price, cp.sl_percent, cp.tp_percent,
             cp.unrealized_pnl, cp.peak_closure_pnl_percent, cp.opened_at, m.end_date, cp.status
      FROM copied_positions cp
      LEFT JOIN markets m ON m.condition_id = cp.condition_id
      WHERE cp.mode='sim' AND cp.reason='ALGO_OPEN' AND cp.status IN ('open','closing','pending')
      ORDER BY cp.opened_at DESC
      LIMIT 10
    `);
    console.log('\n=== OPEN SIM ALGO POSITIONS ===');
    console.table(open.rows);

    const emitBlocks = await client.query(`
      SELECT p.id, p.status, p.close_reason, p.last_exit_block_reason,
             p.last_exit_block_close_reason, p.exit_emit_blocked_count,
             p.first_exit_block_at, p.last_exit_block_at, m.slug
      FROM copied_positions p
      LEFT JOIN markets m ON m.condition_id = p.condition_id
      WHERE p.mode='sim' AND p.reason='ALGO_OPEN'
        AND (p.exit_emit_blocked_count > 0 OR p.last_exit_block_reason IS NOT NULL)
      ORDER BY p.last_exit_block_at DESC NULLS LAST
      LIMIT 20
    `);
    console.log('\n=== EXIT EMIT BLOCKS (open or historical) ===');
    console.table(emitBlocks.rows);

    const redemptionWithBlocks = await client.query(`
      SELECT p.id, m.slug, p.close_reason, p.realized_pnl,
             p.last_exit_block_reason, p.last_exit_block_close_reason,
             p.exit_emit_blocked_count
      FROM copied_positions p
      LEFT JOIN markets m ON m.condition_id = p.condition_id
      WHERE p.mode='sim' AND p.reason='ALGO_OPEN' AND p.status='closed'
        AND p.close_reason='REDEMPTION' AND p.exit_emit_blocked_count > 0
      ORDER BY p.id DESC
      LIMIT 15
    `);
    console.log('\n=== REDEMPTION WITH PRIOR EMIT BLOCKS ===');
    console.table(redemptionWithBlocks.rows);

    const tickStats = await client.query(`
      SELECT COUNT(*)::int AS total_ticks,
             COUNT(DISTINCT t.copied_position_id)::int AS positions_with_ticks
      FROM market_position_ticks t
      JOIN copied_positions p ON p.id = t.copied_position_id
      WHERE p.mode='sim' AND p.reason='ALGO_OPEN'
    `);
    console.log('\n=== TICK DATA AVAILABILITY ===');
    console.log(tickStats.rows[0]);

    const closeReasonPct = await client.query(`
      SELECT close_reason, COUNT(*)::int AS cnt,
             ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 1) AS pct
      FROM copied_positions
      WHERE mode='sim' AND reason='ALGO_OPEN' AND status='closed'
      GROUP BY close_reason
      ORDER BY cnt DESC
    `);
    console.log('\n=== CLOSE REASON DISTRIBUTION (closed only) ===');
    console.table(closeReasonPct.rows);

    const durationStats = await client.query(`
      SELECT
        ROUND(AVG(EXTRACT(EPOCH FROM (closed_at - opened_at)))::numeric, 0) AS avg_sec,
        ROUND(MIN(EXTRACT(EPOCH FROM (closed_at - opened_at)))::numeric, 0) AS min_sec,
        ROUND(MAX(EXTRACT(EPOCH FROM (closed_at - opened_at)))::numeric, 0) AS max_sec
      FROM copied_positions
      WHERE mode='sim' AND reason='ALGO_OPEN' AND status='closed' AND closed_at IS NOT NULL
    `);
    console.log('\n=== POSITION DURATION (open?close) ===');
    console.log(durationStats.rows[0]);

    const pnlStats = await client.query(`
      SELECT
        ROUND(AVG(realized_pnl)::numeric, 4) AS avg_realized,
        ROUND(MIN(realized_pnl)::numeric, 4) AS min_realized,
        ROUND(MAX(realized_pnl)::numeric, 4) AS max_realized,
        ROUND(AVG(peak_closure_pnl_percent)::numeric, 2) AS avg_peak_pct,
        ROUND(MIN(peak_closure_pnl_percent)::numeric, 2) AS min_peak_pct,
        ROUND(MAX(peak_closure_pnl_percent)::numeric, 2) AS max_peak_pct
      FROM copied_positions
      WHERE mode='sim' AND reason='ALGO_OPEN' AND status='closed'
    `);
    console.log('\n=== PNL STATS (closed positions) ===');
    console.log(pnlStats.rows[0]);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
