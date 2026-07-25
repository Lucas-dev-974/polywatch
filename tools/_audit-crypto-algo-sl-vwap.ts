import pg from 'pg';
import { loadMonorepoEnv } from '../packages/core/src/config/env.js';

loadMonorepoEnv();

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const c = await pool.connect();
  try {
    const positions = await c.query(`
      SELECT p.id, p.status, p.close_reason, p.entry_price, p.entry_bid_vwap,
             p.sl_bid_points, p.realized_pnl, p.peak_closure_pnl_percent,
             m.slug
      FROM copied_positions p
      LEFT JOIN markets m ON m.condition_id = p.condition_id
      WHERE p.mode = 'sim' AND p.reason = 'ALGO_OPEN'
      ORDER BY p.id
    `);

    console.log('=== AUDIT SL CRYPTO ALGO (executable_bid_vwap only) ===\n');

    for (const p of positions.rows) {
      const entryBid = Number(p.entry_bid_vwap);
      const slBp = Number(p.sl_bid_points);
      const slThreshold = entryBid - slBp;
      const slPct = ((slBp / entryBid) * 100).toFixed(2);

      const tickStats = await c.query(
        `
        SELECT
          COUNT(*)::int AS total_ticks,
          COUNT(t.executable_bid_vwap) FILTER (WHERE t.executable_bid_vwap > 0)::int AS vwap_ticks,
          MIN(t.executable_bid_vwap) FILTER (WHERE t.executable_bid_vwap > 0) AS min_vwap,
          MAX(t.executable_bid_vwap) FILTER (WHERE t.executable_bid_vwap > 0) AS max_vwap,
          MIN(CASE WHEN t.executable_bid_vwap > 0
            THEN ((t.executable_bid_vwap - $2) / $2) * 100 END) AS min_trigger_pnl,
          MAX(CASE WHEN t.executable_bid_vwap > 0
            THEN ((t.executable_bid_vwap - $2) / $2) * 100 END) AS max_trigger_pnl,
          BOOL_OR(t.executable_bid_vwap > 0 AND t.executable_bid_vwap <= $3) AS sl_breached_vwap
        FROM market_position_ticks t
        WHERE t.copied_position_id = $1
        `,
        [p.id, entryBid, slThreshold],
      );
      const t = tickStats.rows[0];

      const sell = await c.query(
        `SELECT reason, fill_price, realized_pnl, status, error
         FROM executions WHERE copied_position_id=$1 AND side='SELL'
         ORDER BY id`,
        [p.id],
      );

      const slAttempts = await c.query(
        `SELECT COUNT(*)::int AS cnt FROM executions
         WHERE copied_position_id=$1 AND side='SELL' AND reason='SL'`,
        [p.id],
      );

      let verdict: string;
      if (!t.vwap_ticks || Number(t.vwap_ticks) === 0) {
        verdict = 'NON VERIFIABLE (pas de executable_bid_vwap)';
      } else if (p.close_reason === 'SL') {
        verdict = t.sl_breached_vwap
          ? 'OK — SL declenche apres breach VWAP'
          : 'SUSPECT — SL sans breach VWAP enregistre';
      } else if (t.sl_breached_vwap) {
        verdict = 'VIOLATION — breach VWAP sans close_reason=SL';
      } else {
        verdict = 'OK — seuil SL non franchi (VWAP)';
      }

      console.log(`#${p.id} ${p.slug} [${p.status}/${p.close_reason ?? '-'}]`);
      console.log(
        JSON.stringify(
          {
            entryBid,
            sl_bid_points: slBp,
            sl_threshold_bid: slThreshold.toFixed(4),
            sl_pct_equiv: `${slPct}%`,
            ticks: { total: t.total_ticks, with_vwap: t.vwap_ticks },
            min_vwap: t.min_vwap != null ? Number(t.min_vwap).toFixed(4) : null,
            max_vwap: t.max_vwap != null ? Number(t.max_vwap).toFixed(4) : null,
            min_trigger_pnl:
              t.min_trigger_pnl != null
                ? `${Number(t.min_trigger_pnl).toFixed(2)}%`
                : null,
            max_trigger_pnl:
              t.max_trigger_pnl != null
                ? `${Number(t.max_trigger_pnl).toFixed(2)}%`
                : null,
            sl_breached_vwap: t.sl_breached_vwap,
            peak_closure_pct: p.peak_closure_pnl_percent,
            realized_pnl: p.realized_pnl,
            sl_attempts: slAttempts.rows[0]?.cnt ?? 0,
            sells: sell.rows,
            verdict,
          },
          null,
          2,
        ),
      );
      console.log('');
    }

    const summary = await c.query(`
      SELECT close_reason, COUNT(*)::int cnt,
             ROUND(AVG(realized_pnl)::numeric, 4) avg_pnl,
             ROUND(SUM(realized_pnl)::numeric, 4) total_pnl
      FROM copied_positions
      WHERE mode='sim' AND reason='ALGO_OPEN' AND status='closed'
      GROUP BY close_reason ORDER BY cnt DESC
    `);
    console.log('=== RESUME PAR CLOSE_REASON ===');
    console.table(summary.rows);

    const failedTp = await c.query(`
      SELECT COUNT(*)::int cnt FROM executions e
      JOIN copied_positions p ON p.id = e.copied_position_id
      WHERE p.reason='ALGO_OPEN' AND e.side='SELL' AND e.reason='TP' AND e.status='failed'
    `);
    console.log('TP failed (no_liquidity etc.):', failedTp.rows[0]?.cnt);
  } finally {
    c.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
