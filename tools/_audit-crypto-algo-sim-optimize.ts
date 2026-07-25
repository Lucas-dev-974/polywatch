/**
 * Audit SIM crypto-algo: config + positions + surveillance ticks + leviers d'optimisation.
 * Usage: npx tsx tools/_audit-crypto-algo-sim-optimize.ts
 */
import pg from 'pg';
import { loadMonorepoEnv } from '../packages/core/src/config/env.js';

loadMonorepoEnv();

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const j = (v: unknown) => JSON.stringify(v, null, 2);

async function main() {
  const c = await pool.connect();
  try {
    // ── 1. CONFIG CRYPTO ALGO + SIM ──────────────────────────────────────
    console.log('=== 1. RISK CONFIG CRYPTO ALGO (full tunables) ===');
    const rc = await c.query(`
      SELECT
        crypto_algo_enabled,
        crypto_algo_strategies,
        crypto_algo_sl_enabled, crypto_algo_tp_enabled, crypto_algo_trailing_enabled,
        crypto_algo_sl_bid_points, crypto_algo_tp_bid_points,
        crypto_algo_sl_percent, crypto_algo_tp_percent,
        crypto_algo_trailing_stop_percent, crypto_algo_trailing_activation_percent,
        crypto_algo_pre_close_enabled, crypto_algo_pre_close_seconds,
        crypto_algo_pre_close_hold_if_winning, crypto_algo_pre_close_win_confidence_bid,
        crypto_algo_time_exit_enabled, crypto_algo_time_exit_seconds,
        crypto_algo_time_exit_win_confidence_bid, crypto_algo_time_exit_max_retries,
        crypto_algo_min_time_to_close, crypto_algo_min_time_to_close_buffer_seconds,
        crypto_algo_reentry_window_ms, crypto_algo_max_entries_per_window,
        sl_confirmation_ticks,
        crypto_algo_base_threshold, crypto_algo_spread_adjustment_factor,
        crypto_algo_min_spread_abs_for_adjustment, crypto_algo_max_spread_abs,
        crypto_algo_price_sum_tolerance, crypto_algo_warn_price_deviation,
        crypto_algo_max_book_age_ms, crypto_algo_ws_debounce_ms, crypto_algo_poll_ms,
        crypto_algo_tick_interval_ms, crypto_algo_price_tick_ref_qty,
        crypto_algo_spread_abs_by_interval, crypto_algo_exit_defaults_by_interval,
        crypto_algo_pre_close_seconds_by_interval, crypto_algo_time_exit_seconds_by_interval,
        sim_initial_capital, sim_sl_enabled, sim_tp_enabled,
        sim_sl_percent, sim_tp_percent,
        sim_sl_bid_points, sim_tp_bid_points,
        sim_pre_close_enabled, sim_pre_close_seconds, sim_pre_close_hold_if_winning,
        sim_trailing_enabled, sim_trailing_stop_percent,
        sim_sizing_mode, sim_entry_usdc_amount, sim_copy_trading_enabled
      FROM risk_config LIMIT 1
    `);
    console.log(j(rc.rows[0]));

    const bal = await c.query(`SELECT * FROM simulation_balances`);
    console.log('\n=== SIM BALANCE ===');
    console.log(j(bal.rows));

    // ── 2. POSITIONS SIM ALGO ────────────────────────────────────────────
    console.log('\n=== 2. POSITIONS SIM ALGO — BY STATUS / CLOSE_REASON ===');
    const counts = await c.query(`
      SELECT status, close_reason, COUNT(*)::int AS cnt,
             ROUND(SUM(realized_pnl)::numeric, 4) AS sum_pnl,
             ROUND(AVG(realized_pnl)::numeric, 4) AS avg_pnl,
             SUM(CASE WHEN realized_pnl > 0 THEN 1 ELSE 0 END)::int AS wins,
             SUM(CASE WHEN realized_pnl < 0 THEN 1 ELSE 0 END)::int AS losses
      FROM copied_positions
      WHERE mode = 'sim' AND reason = 'ALGO_OPEN'
      GROUP BY status, close_reason
      ORDER BY status, close_reason
    `);
    console.table(counts.rows);

    const pnlByReason = await c.query(`
      SELECT close_reason,
             COUNT(*)::int AS n,
             ROUND(SUM(realized_pnl)::numeric, 4) AS total_pnl,
             ROUND(AVG(realized_pnl)::numeric, 4) AS avg_pnl,
             ROUND(MIN(realized_pnl)::numeric, 4) AS min_pnl,
             ROUND(MAX(realized_pnl)::numeric, 4) AS max_pnl,
             SUM(CASE WHEN realized_pnl > 0 THEN 1 ELSE 0 END)::int AS wins,
             SUM(CASE WHEN realized_pnl <= 0 THEN 1 ELSE 0 END)::int AS losses,
             ROUND(AVG(peak_closure_pnl_percent)::numeric, 2) AS avg_peak_pct,
             ROUND(AVG(EXTRACT(EPOCH FROM (closed_at - opened_at)))::numeric, 0) AS avg_duration_sec,
             ROUND(AVG(entry_price)::numeric, 4) AS avg_entry,
             ROUND(AVG(quantity)::numeric, 2) AS avg_qty
      FROM copied_positions
      WHERE mode = 'sim' AND reason = 'ALGO_OPEN' AND status = 'closed'
      GROUP BY close_reason
      ORDER BY total_pnl ASC
    `);
    console.log('\n=== PNL PAR CLOSE_REASON (closed) ===');
    console.table(pnlByReason.rows);

    const positions = await c.query(`
      SELECT p.id, p.condition_id, p.outcome, p.status,
             p.entry_price, p.entry_bid_vwap, p.quantity,
             p.sl_percent, p.tp_percent, p.sl_bid_points, p.tp_bid_points,
             p.trailing_stop_percent, p.realized_pnl, p.unrealized_pnl,
             p.peak_closure_pnl_percent, p.close_reason,
             p.opened_at, p.closed_at,
             EXTRACT(EPOCH FROM (COALESCE(p.closed_at, NOW()) - p.opened_at))::int AS duration_sec,
             p.last_exit_block_reason, p.last_exit_block_close_reason,
             p.exit_emit_blocked_count,
             m.slug, m.end_date, m.resolved, m.winning_token_id,
             m.market_type
      FROM copied_positions p
      LEFT JOIN markets m ON m.condition_id = p.condition_id
      WHERE p.mode = 'sim' AND p.reason = 'ALGO_OPEN'
      ORDER BY COALESCE(p.closed_at, p.opened_at) DESC
    `);
    console.log(`\n=== 2b. TOUTES POSITIONS SIM ALGO (${positions.rows.length}) ===`);
    for (const p of positions.rows) {
      console.log(
        JSON.stringify({
          id: p.id,
          slug: p.slug,
          outcome: p.outcome,
          status: p.status,
          close_reason: p.close_reason,
          entry: Number(p.entry_price),
          entry_bid_vwap: p.entry_bid_vwap != null ? Number(p.entry_bid_vwap) : null,
          qty: Number(p.quantity),
          sl_pct: p.sl_percent,
          tp_pct: p.tp_percent,
          sl_bp: p.sl_bid_points,
          tp_bp: p.tp_bid_points,
          realized: p.realized_pnl != null ? Number(p.realized_pnl) : null,
          peak_pct: p.peak_closure_pnl_percent != null ? Number(p.peak_closure_pnl_percent) : null,
          duration_sec: p.duration_sec,
          exit_blocks: p.exit_emit_blocked_count,
          last_block: p.last_exit_block_reason,
          end_date: p.end_date,
          resolved: p.resolved,
        }),
      );
    }

    // ── 3. SURVEILLANCE MARCHÉ PAR POSITION ──────────────────────────────
    console.log('\n=== 3. SURVEILLANCE — market_position_ticks PAR POSITION ===');
    const tickSummary = await c.query(`
      SELECT
        p.id AS position_id,
        p.close_reason,
        p.realized_pnl,
        p.entry_price,
        p.entry_bid_vwap,
        p.sl_bid_points,
        p.sl_percent,
        p.tp_bid_points,
        p.tp_percent,
        p.peak_closure_pnl_percent,
        m.slug,
        COUNT(t.id)::int AS tick_count,
        MIN(t.created_at) AS first_tick,
        MAX(t.created_at) AS last_tick,
        MIN(NULLIF(t.executable_bid_vwap, 0)) AS min_vwap,
        MAX(NULLIF(t.executable_bid_vwap, 0)) AS max_vwap,
        MIN(NULLIF(t.best_bid, 0)) AS min_bid,
        MAX(NULLIF(t.best_bid, 0)) AS max_bid,
        AVG(NULLIF(t.executable_bid_vwap, 0)) AS avg_vwap
      FROM copied_positions p
      LEFT JOIN markets m ON m.condition_id = p.condition_id
      LEFT JOIN market_position_ticks t ON t.copied_position_id = p.id
        AND t.created_at BETWEEN p.opened_at AND COALESCE(p.closed_at, NOW())
      WHERE p.mode = 'sim' AND p.reason = 'ALGO_OPEN'
      GROUP BY p.id, p.close_reason, p.realized_pnl, p.entry_price, p.entry_bid_vwap,
               p.sl_bid_points, p.sl_percent, p.tp_bid_points, p.tp_percent,
               p.peak_closure_pnl_percent, m.slug
      ORDER BY p.id DESC
    `);
    console.table(
      tickSummary.rows.map((r) => ({
        id: r.position_id,
        slug: String(r.slug ?? '').slice(0, 40),
        close: r.close_reason,
        pnl: r.realized_pnl != null ? Number(Number(r.realized_pnl).toFixed(4)) : null,
        ticks: r.tick_count,
        entry: r.entry_price != null ? Number(Number(r.entry_price).toFixed(4)) : null,
        min_vwap: r.min_vwap != null ? Number(Number(r.min_vwap).toFixed(4)) : null,
        max_vwap: r.max_vwap != null ? Number(Number(r.max_vwap).toFixed(4)) : null,
        peak_pct: r.peak_closure_pnl_percent != null ? Number(Number(r.peak_closure_pnl_percent).toFixed(2)) : null,
        sl_bp: r.sl_bid_points,
        tp_bp: r.tp_bid_points,
      })),
    );

    // MFE / MAE style: leave money on table vs drawdown from ticks
    console.log('\n=== 3b. MFE/MAE PROXY (ticks vs entry_bid_vwap) ===');
    const mfeMae: Record<string, unknown>[] = [];
    for (const row of tickSummary.rows) {
      if (!row.tick_count || Number(row.tick_count) === 0) continue;
      const entryRef = Number(row.entry_bid_vwap || row.entry_price || 0);
      if (!(entryRef > 0)) continue;
      const minV = row.min_vwap != null ? Number(row.min_vwap) : null;
      const maxV = row.max_vwap != null ? Number(row.max_vwap) : null;
      const maePct = minV != null ? ((minV - entryRef) / entryRef) * 100 : null;
      const mfePct = maxV != null ? ((maxV - entryRef) / entryRef) * 100 : null;
      const realized = row.realized_pnl != null ? Number(row.realized_pnl) : null;
      const peak = row.peak_closure_pnl_percent != null ? Number(row.peak_closure_pnl_percent) : null;
      mfeMae.push({
        id: row.position_id,
        close: row.close_reason,
        realized: realized != null ? Number(realized.toFixed(4)) : null,
        mae_pct: maePct != null ? Number(maePct.toFixed(2)) : null,
        mfe_pct: mfePct != null ? Number(mfePct.toFixed(2)) : null,
        peak_pct: peak != null ? Number(peak.toFixed(2)) : null,
        entry: Number(entryRef.toFixed(4)),
        min_vwap: minV != null ? Number(minV.toFixed(4)) : null,
        max_vwap: maxV != null ? Number(maxV.toFixed(4)) : null,
        sl_bp: row.sl_bid_points,
        tp_bp: row.tp_bid_points,
      });
    }
    console.table(mfeMae);

    // SL / TP threshold breach analysis
    console.log('\n=== 3c. BREACH SL/TP (bid points) SANS CLOSE CORRESPONDANT ===');
    const breaches: Record<string, unknown>[] = [];
    for (const p of positions.rows) {
      if (p.status !== 'closed') continue;
      const entryVwap = Number(p.entry_bid_vwap || 0);
      const slBp = p.sl_bid_points != null ? Number(p.sl_bid_points) : null;
      const tpBp = p.tp_bid_points != null ? Number(p.tp_bid_points) : null;
      if (!(entryVwap > 0)) continue;

      if (slBp != null && slBp > 0 && p.close_reason !== 'SL') {
        const thr = entryVwap - slBp;
        const r = await c.query(
          `
          SELECT COUNT(*)::int AS n, MIN(executable_bid_vwap) AS min_v
          FROM market_position_ticks
          WHERE copied_position_id = $1
            AND executable_bid_vwap > 0
            AND executable_bid_vwap <= $2
            AND created_at BETWEEN $3 AND COALESCE($4, NOW())
          `,
          [p.id, thr, p.opened_at, p.closed_at],
        );
        if (r.rows[0]?.n > 0) {
          breaches.push({
            type: 'SL_MISSED',
            id: p.id,
            close: p.close_reason,
            pnl: Number(p.realized_pnl),
            thr: Number(thr.toFixed(4)),
            ticks_below: r.rows[0].n,
            min_v: r.rows[0].min_v != null ? Number(Number(r.rows[0].min_v).toFixed(4)) : null,
          });
        }
      }

      if (tpBp != null && tpBp > 0 && p.close_reason !== 'TP') {
        const thr = entryVwap + tpBp;
        const r = await c.query(
          `
          SELECT COUNT(*)::int AS n, MAX(executable_bid_vwap) AS max_v
          FROM market_position_ticks
          WHERE copied_position_id = $1
            AND executable_bid_vwap > 0
            AND executable_bid_vwap >= $2
            AND created_at BETWEEN $3 AND COALESCE($4, NOW())
          `,
          [p.id, thr, p.opened_at, p.closed_at],
        );
        if (r.rows[0]?.n > 0) {
          breaches.push({
            type: 'TP_MISSED',
            id: p.id,
            close: p.close_reason,
            pnl: Number(p.realized_pnl),
            thr: Number(thr.toFixed(4)),
            ticks_above: r.rows[0].n,
            max_v: r.rows[0].max_v != null ? Number(Number(r.rows[0].max_v).toFixed(4)) : null,
          });
        }
      }
    }
    console.table(breaches);

    // algo_price_ticks coverage for position markets
    console.log('\n=== 3d. ALGO_PRICE_TICKS COVERAGE (marchés des positions) ===');
    const algoTickCov = await c.query(`
      SELECT p.id AS position_id, m.slug,
             COUNT(apt.*)::int AS algo_ticks,
             MIN(apt.recorded_at) AS first_apt,
             MAX(apt.recorded_at) AS last_apt
      FROM copied_positions p
      LEFT JOIN markets m ON m.condition_id = p.condition_id
      LEFT JOIN algo_price_ticks apt ON apt.condition_id = p.condition_id
        AND apt.recorded_at BETWEEN p.opened_at - INTERVAL '2 minutes'
                                AND COALESCE(p.closed_at, NOW()) + INTERVAL '1 minute'
      WHERE p.mode = 'sim' AND p.reason = 'ALGO_OPEN'
      GROUP BY p.id, m.slug
      ORDER BY p.id DESC
    `);
    console.table(
      algoTickCov.rows.map((r) => ({
        id: r.position_id,
        slug: String(r.slug ?? '').slice(0, 45),
        algo_ticks: r.algo_ticks,
        first: r.first_apt,
        last: r.last_apt,
      })),
    );

    // exit attempts
    console.log('\n=== 3e. EXIT ATTEMPT EVENTS (sim algo) ===');
    const exitAttempts = await c.query(`
      SELECT e.kind, e.close_reason, e.block_reason, e.error, COUNT(*)::int AS n
      FROM exit_attempt_events e
      JOIN copied_positions p ON p.id = e.copied_position_id
      WHERE p.mode = 'sim' AND p.reason = 'ALGO_OPEN'
      GROUP BY e.kind, e.close_reason, e.block_reason, e.error
      ORDER BY n DESC
      LIMIT 40
    `);
    console.table(exitAttempts.rows);

    // ── 4. OPTIMISATION HEURISTICS ───────────────────────────────────────
    console.log('\n=== 4. HEURISTIQUES OPTIMISATION ===');

    const winners = await c.query(`
      SELECT COUNT(*)::int AS n,
             ROUND(SUM(realized_pnl)::numeric, 4) AS sum_pnl,
             ROUND(AVG(realized_pnl)::numeric, 4) AS avg_pnl,
             ROUND(AVG(peak_closure_pnl_percent)::numeric, 2) AS avg_peak,
             ROUND(AVG(entry_price)::numeric, 4) AS avg_entry
      FROM copied_positions
      WHERE mode='sim' AND reason='ALGO_OPEN' AND status='closed' AND realized_pnl > 0
    `);
    const losers = await c.query(`
      SELECT COUNT(*)::int AS n,
             ROUND(SUM(realized_pnl)::numeric, 4) AS sum_pnl,
             ROUND(AVG(realized_pnl)::numeric, 4) AS avg_pnl,
             ROUND(AVG(peak_closure_pnl_percent)::numeric, 2) AS avg_peak,
             ROUND(AVG(entry_price)::numeric, 4) AS avg_entry
      FROM copied_positions
      WHERE mode='sim' AND reason='ALGO_OPEN' AND status='closed' AND realized_pnl <= 0
    `);
    console.log('Winners:', j(winners.rows[0]));
    console.log('Losers:', j(losers.rows[0]));

    const byEntryBucket = await c.query(`
      SELECT
        CASE
          WHEN entry_price < 0.35 THEN 'a_<0.35'
          WHEN entry_price < 0.45 THEN 'b_0.35-0.45'
          WHEN entry_price < 0.55 THEN 'c_0.45-0.55'
          WHEN entry_price < 0.65 THEN 'd_0.55-0.65'
          ELSE 'e_>=0.65'
        END AS entry_bucket,
        COUNT(*)::int AS n,
        ROUND(SUM(realized_pnl)::numeric, 4) AS total_pnl,
        ROUND(AVG(realized_pnl)::numeric, 4) AS avg_pnl,
        SUM(CASE WHEN realized_pnl > 0 THEN 1 ELSE 0 END)::int AS wins
      FROM copied_positions
      WHERE mode='sim' AND reason='ALGO_OPEN' AND status='closed'
      GROUP BY 1
      ORDER BY 1
    `);
    console.log('\nPnL par bucket entry_price:');
    console.table(byEntryBucket.rows);

    const giveback = await c.query(`
      SELECT id, close_reason, realized_pnl, peak_closure_pnl_percent, entry_price, quantity
      FROM copied_positions
      WHERE mode='sim' AND reason='ALGO_OPEN' AND status='closed'
        AND peak_closure_pnl_percent IS NOT NULL
        AND peak_closure_pnl_percent > 5
        AND realized_pnl < 0
      ORDER BY peak_closure_pnl_percent DESC
      LIMIT 20
    `);
    console.log('\nGiveback: peak>5% puis PnL négatif:');
    console.table(giveback.rows);

    const leftOnTable = await c.query(`
      SELECT id, close_reason, realized_pnl, peak_closure_pnl_percent, entry_price, quantity,
             ROUND((peak_closure_pnl_percent / 100.0 * entry_price * quantity)::numeric, 4) AS approx_peak_usd
      FROM copied_positions
      WHERE mode='sim' AND reason='ALGO_OPEN' AND status='closed'
        AND peak_closure_pnl_percent IS NOT NULL
        AND peak_closure_pnl_percent > 10
        AND realized_pnl > 0
        AND realized_pnl < (peak_closure_pnl_percent / 100.0 * entry_price * quantity) * 0.4
      ORDER BY peak_closure_pnl_percent DESC
      LIMIT 20
    `);
    console.log('\nLeft on table: peak>10% mais réalisé << peak:');
    console.table(leftOnTable.rows);

    const redemptionLoss = await c.query(`
      SELECT p.id, m.slug, p.outcome, p.realized_pnl, p.entry_price, p.quantity,
             p.peak_closure_pnl_percent, p.exit_emit_blocked_count,
             p.last_exit_block_reason, p.last_exit_block_close_reason
      FROM copied_positions p
      LEFT JOIN markets m ON m.condition_id = p.condition_id
      WHERE p.mode='sim' AND p.reason='ALGO_OPEN' AND p.status='closed'
        AND p.close_reason='REDEMPTION' AND p.realized_pnl < 0
      ORDER BY p.realized_pnl ASC
      LIMIT 25
    `);
    console.log('\nREDEMPTION perdantes (sorties manquées?):');
    console.table(redemptionLoss.rows);

    const totals = await c.query(`
      SELECT
        COUNT(*) FILTER (WHERE status='closed')::int AS closed_n,
        ROUND(SUM(realized_pnl) FILTER (WHERE status='closed')::numeric, 4) AS total_realized,
        COUNT(*) FILTER (WHERE status IN ('open','closing','pending','pending_resolution'))::int AS open_like_n,
        ROUND(SUM(unrealized_pnl) FILTER (WHERE status IN ('open','closing'))::numeric, 4) AS unrealized
      FROM copied_positions
      WHERE mode='sim' AND reason='ALGO_OPEN'
    `);
    console.log('\n=== TOTALS ===');
    console.log(j(totals.rows[0]));
  } finally {
    c.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
