import pg from 'pg';
import { loadMonorepoEnv } from '../packages/core/src/config/env.js';

loadMonorepoEnv();

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

interface PositionRow {
  id: number;
  status: string;
  close_reason: string | null;
  entry_price: number;
  entry_bid_vwap: number;
  sl_bid_points: number | null;
  tp_bid_points: number | null;
  sl_percent: number | null;
  tp_percent: number | null;
  realized_pnl: number | null;
  peak_closure_pnl_percent: number | null;
  unrealized_pnl: number | null;
  opened_at: Date;
  closed_at: Date | null;
  slug: string | null;
  end_date: Date | null;
}

async function main() {
  const c = await pool.connect();
  try {
    const rc = await c.query(`
      SELECT crypto_algo_sl_bid_points, crypto_algo_tp_bid_points,
             crypto_algo_sl_percent, crypto_algo_tp_percent
      FROM risk_config LIMIT 1
    `);
    console.log('=== RISK CONFIG ALGO SL/TP ===');
    console.log(JSON.stringify(rc.rows[0], null, 2));

    const positions = await c.query<PositionRow>(`
      SELECT p.id, p.status, p.close_reason, p.entry_price, p.entry_bid_vwap,
             p.sl_bid_points, p.tp_bid_points, p.sl_percent, p.tp_percent,
             p.realized_pnl, p.peak_closure_pnl_percent, p.unrealized_pnl,
             p.opened_at, p.closed_at, m.slug, m.end_date
      FROM copied_positions p
      LEFT JOIN markets m ON m.condition_id = p.condition_id
      WHERE p.mode = 'sim' AND p.reason = 'ALGO_OPEN'
      ORDER BY p.id
    `);

    console.log(`\n=== ALL SIM ALGO POSITIONS (${positions.rows.length}) ===`);
    for (const p of positions.rows) {
      const slBp = p.sl_bid_points;
      const entryBid = p.entry_bid_vwap;
      const slThreshold =
        slBp != null && entryBid > 0 ? entryBid - slBp : null;
      const slPctEquiv =
        slBp != null && entryBid > 0
          ? ((slBp / entryBid) * 100).toFixed(2)
          : null;
      console.log(
        JSON.stringify({
          id: p.id,
          status: p.status,
          close_reason: p.close_reason,
          slug: p.slug,
          entry: p.entry_price,
          entryBid,
          sl_bid_points: slBp,
          tp_bid_points: p.tp_bid_points,
          sl_threshold_bid: slThreshold?.toFixed(4),
          sl_pct_equiv: slPctEquiv,
          realized: p.realized_pnl,
          peak_closure_pct: p.peak_closure_pnl_percent,
        }),
      );
    }

    console.log('\n=== SL BID-POINTS COMPLIANCE (via ticks) ===');
    const violations: Record<string, unknown>[] = [];
    const slClosed: Record<string, unknown>[] = [];
    const noTicks: Record<string, unknown>[] = [];
    const conformClosed: Record<string, unknown>[] = [];

    for (const p of positions.rows) {
      const slBp = p.sl_bid_points;
      const entryBid = Number(p.entry_bid_vwap);
      if (!slBp || slBp <= 0 || !entryBid || entryBid <= 0) {
        console.log(
          `SKIP #${p.id}: no sl_bid_points (${slBp}) or entry_bid_vwap (${entryBid})`,
        );
        continue;
      }
      const slThreshold = entryBid - Number(slBp);

      const ticks = await c.query<{
        min_bid: string | null;
        min_trigger_pnl: string | null;
        max_trigger_pnl: string | null;
        tick_count: number;
        opened_at: Date;
        closed_at: Date | null;
        first_tick: Date | null;
      }>(
        `
        WITH pos AS (
          SELECT opened_at, closed_at FROM copied_positions WHERE id = $1
        )
        SELECT MIN(COALESCE(NULLIF(t.executable_bid_vwap, 0), NULLIF(t.best_bid, 0), NULLIF(t.last_trade_price, 0))) AS min_bid,
               MIN(CASE WHEN p2.entry_bid_vwap > 0 AND COALESCE(t.executable_bid_vwap, NULLIF(t.best_bid, 0)) IS NOT NULL
                 THEN ((COALESCE(t.executable_bid_vwap, t.best_bid) - p2.entry_bid_vwap) / p2.entry_bid_vwap) * 100 END) AS min_trigger_pnl,
               MAX(CASE WHEN p2.entry_bid_vwap > 0 AND COALESCE(t.executable_bid_vwap, NULLIF(t.best_bid, 0)) IS NOT NULL
                 THEN ((COALESCE(t.executable_bid_vwap, t.best_bid) - p2.entry_bid_vwap) / p2.entry_bid_vwap) * 100 END) AS max_trigger_pnl,
               COUNT(*)::int AS tick_count,
               pos.opened_at,
               pos.closed_at,
               MIN(t.created_at) AS first_tick
        FROM market_position_ticks t
        JOIN copied_positions p2 ON p2.id = t.copied_position_id
        CROSS JOIN pos
        WHERE t.copied_position_id = $1
        GROUP BY pos.opened_at, pos.closed_at
        `,
        [p.id],
      );
      const t = ticks.rows[0];
      const minBid = t?.min_bid != null ? Number(t.min_bid) : null;
      const minTrigger =
        t?.min_trigger_pnl != null ? Number(t.min_trigger_pnl) : null;
      const maxTrigger =
        t?.max_trigger_pnl != null ? Number(t.max_trigger_pnl) : null;
      const tickCount = t?.tick_count ?? 0;
      const slBreached = minBid != null && minBid <= slThreshold + 0.0001;

      if (tickCount === 0) {
        noTicks.push({
          id: p.id,
          close_reason: p.close_reason,
          status: p.status,
        });
        continue;
      }

      if (p.status === 'closed' && p.close_reason === 'SL') {
        const sell = await c.query<{ fill_price: number; realized_pnl: number }>(
          `SELECT fill_price, realized_pnl FROM executions
           WHERE copied_position_id=$1 AND side='SELL' AND status='filled' AND reason='SL'
           ORDER BY id DESC LIMIT 1`,
          [p.id],
        );
        slClosed.push({
          id: p.id,
          slug: p.slug,
          entryBid,
          slBp,
          slThreshold: slThreshold.toFixed(4),
          minBid,
          minTrigger: minTrigger?.toFixed(2),
          maxTrigger: maxTrigger?.toFixed(2),
          fillPrice: sell.rows[0]?.fill_price,
          realized: p.realized_pnl,
          ticks: tickCount,
        });
        continue;
      }

      if (p.status === 'closed' && !slBreached) {
        conformClosed.push({
          id: p.id,
          close_reason: p.close_reason,
          minBid,
          slThreshold: slThreshold.toFixed(4),
          minTrigger: minTrigger?.toFixed(2),
        });
        continue;
      }

      if (slBreached && p.close_reason !== 'SL') {
        violations.push({
          id: p.id,
          close_reason: p.close_reason,
          status: p.status,
          slug: p.slug,
          slBp,
          entryBid,
          slThreshold: slThreshold.toFixed(4),
          minBid,
          minTrigger: minTrigger?.toFixed(2),
          peak: p.peak_closure_pnl_percent,
          realized: p.realized_pnl,
          ticks: tickCount,
        });
      }
    }

    console.log(
      `\nViolations (bid <= entryBid - slBidPoints but close_reason != SL): ${violations.length}`,
    );
    violations.forEach((v) => console.log(JSON.stringify(v)));

    console.log(`\nConform closed (no SL breach in ticks): ${conformClosed.length}`);
    conformClosed.forEach((v) => console.log(JSON.stringify(v)));

    console.log('\n=== SL CLOSED POSITIONS DETAIL ===');
    slClosed.forEach((v) => console.log(JSON.stringify(v)));

    console.log(`\nPositions without ticks: ${noTicks.length}`);
    noTicks.forEach((v) => console.log(JSON.stringify(v)));

    console.log('\n=== OPEN POSITIONS SL PROXIMITY ===');
    for (const p of positions.rows.filter((r) => r.status === 'open')) {
      const slBp = p.sl_bid_points;
      const entryBid = Number(p.entry_bid_vwap);
      if (!slBp || !entryBid) continue;
      const slThreshold = entryBid - Number(slBp);
      const latest = await c.query<{
        executable_bid_vwap: number | null;
        best_bid: number | null;
        created_at: Date;
      }>(
        `SELECT executable_bid_vwap, best_bid, created_at FROM market_position_ticks
         WHERE copied_position_id=$1 ORDER BY created_at DESC LIMIT 1`,
        [p.id],
      );
      const curBid =
        latest.rows[0]?.executable_bid_vwap ?? latest.rows[0]?.best_bid;
      console.log(
        JSON.stringify({
          id: p.id,
          slug: p.slug,
          entryBid,
          slThreshold: slThreshold.toFixed(4),
          currentBid: curBid,
          belowSl: curBid != null && Number(curBid) <= slThreshold,
          unrealized: p.unrealized_pnl,
          peak: p.peak_closure_pnl_percent,
          lastTick: latest.rows[0]?.created_at,
        }),
      );
    }

    console.log('\n=== TICK COVERAGE ===');
    const tickDbg = await c.query(
      `
      SELECT copied_position_id, COUNT(*)::int AS cnt,
             MIN(created_at) AS first_tick, MAX(created_at) AS last_tick
      FROM market_position_ticks
      WHERE copied_position_id = ANY($1::int[])
      GROUP BY copied_position_id ORDER BY copied_position_id
    `,
      [positions.rows.map((p) => p.id)],
    );
    console.table(tickDbg.rows);

    console.log('\n=== RESUME ===');
    console.log(
      JSON.stringify(
        {
          totalAlgoPositions: positions.rows.length,
          closed: positions.rows.filter((p) => p.status === 'closed').length,
          closedBySl: slClosed.length,
          slViolations: violations.length,
          noTicks,
          configSlBidPoints: rc.rows[0]?.crypto_algo_sl_bid_points,
        },
        null,
        2,
      ),
    );
  } finally {
    c.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
