import pg from 'pg';
import { loadMonorepoEnv } from '../packages/core/src/config/env.js';

loadMonorepoEnv();

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

function pct(part: number | null, total: number | null): number | null {
  if (part == null || total == null || total === 0) return null;
  return (part / total) * 100;
}

/** Closure PnL% au moment d'un tick = (bid_vwap - entry_cost_per_unit) / entry_cost_per_unit * 100
 *  entry_cost_per_unit = entry_price + entry_fees_remaining / qty_remaining
 */
function closurePnlPct(
  bidVwap: number | null,
  entryPrice: number,
  entryFeesRem: number,
  qtyRem: number | null,
  qty: number,
): number | null {
  if (bidVwap == null) return null;
  const effQty = qtyRem ?? qty;
  if (!effQty) return null;
  const costPerUnit = entryPrice + (entryFeesRem ?? 0) / effQty;
  if (!costPerUnit) return null;
  return ((bidVwap - costPerUnit) / costPerUnit) * 100;
}

/** Trigger PnL% = (bid_vwap - entry_bid_vwap) / entry_bid_vwap * 100 */
function triggerPnlPct(bidVwap: number | null, entryBidVwap: number): number | null {
  if (bidVwap == null || !entryBidVwap) return null;
  return ((bidVwap - entryBidVwap) / entryBidVwap) * 100;
}

async function main() {
  const client = await pool.connect();
  try {
    // ============================================================
    // 1. RISK CONFIG COMPLETE
    // ============================================================
    console.log('========================================================');
    console.log(' 1. RISK CONFIG COMPLETE (risk_config table)');
    console.log('========================================================');
    const cfg = await client.query('SELECT * FROM risk_config LIMIT 1');
    const config = cfg.rows[0] || {};
    console.log(JSON.stringify(config, null, 2));

    // ============================================================
    // 2. TOUTES LES POSITIONS FERMEES PAR SL (close_reason='SL')
    //    Pour chacune: sl_percent, entry_price, entry_bid_vwap,
    //    fill_price de l'exécution SL, trigger PnL et closure PnL au fill
    // ============================================================
    console.log('\n========================================================');
    console.log(' 2. POSITIONS FERMEES PAR SL (close_reason=SL)');
    console.log('========================================================');

    const slPositions = await client.query(`
      SELECT p.id, p.condition_id, p.outcome, p.quantity, p.entry_price, p.entry_bid_vwap,
             p.entry_fees, p.entry_fees_remaining, p.entry_quantity_remaining,
             p.sl_percent, p.sl_bid_points, p.tp_percent, p.trailing_stop_percent,
             p.realized_pnl, p.peak_closure_pnl_percent, p.unrealized_pnl,
             p.opened_at, p.closed_at, p.closing_started_at, p.mode, p.reason,
             p.close_reason, p.increase_count, p.liquidity_status,
             p.executable_bid_vwap, p.last_closeable_bid_vwap, p.last_closeable_bid_at
      FROM copied_positions p
      WHERE p.close_reason = 'SL'
      ORDER BY p.id
    `);

    console.log(`Total positions fermees par SL: ${slPositions.rowCount}\n`);

    const slAnalysis: any[] = [];
    for (const p of slPositions.rows) {
      // Recupere l'execution SELL (SL fill)
      const slExec = await client.query(
        `SELECT id, side, status, reason, error, fill_price, fill_quantity, fees,
                realized_pnl, reference_vwap, executed_at, requested_qty
         FROM executions WHERE copied_position_id = $1 ORDER BY id`,
        [p.id],
      );
      const sellExec = slExec.rows.find((e: any) => e.side === 'SELL' && e.status === 'filled') || null;
      const buyExec = slExec.rows.find((e: any) => e.side === 'BUY' && e.status === 'filled') || null;

      // Calcule le trigger PnL% et closure PnL% au moment du fill SL
      let triggerPnlAtFill: number | null = null;
      let closurePnlAtFill: number | null = null;
      let tickAtFill: any = null;

      if (sellExec?.executed_at) {
        // Cherche le tick le plus proche avant l'execution SL
        const tick = await client.query(
          `SELECT t.id, t.best_bid, t.best_ask, t.executable_bid_vwap, t.executable_ask_vwap,
                  t.mid_price, t.last_trade_price, t.created_at
           FROM market_position_ticks t
           WHERE t.copied_position_id = $1
             AND t.created_at <= $2
           ORDER BY t.created_at DESC
           LIMIT 1`,
          [p.id, sellExec.executed_at],
        );
        if (tick.rows.length > 0) {
          tickAtFill = tick.rows[0];
          triggerPnlAtFill = triggerPnlPct(tick.rows[0].executable_bid_vwap, p.entry_bid_vwap);
          closurePnlAtFill = closurePnlPct(
            tick.rows[0].executable_bid_vwap,
            p.entry_price,
            p.entry_fees_remaining,
            p.entry_quantity_remaining,
            p.quantity,
          );
        }
      }

      // PnL realise calcule depuis le fill price de l'execution SL
      const fillPrice = sellExec?.fill_price ?? null;
      const fillQty = sellExec?.fill_quantity ?? p.entry_quantity_remaining ?? p.quantity;
      const entryCostPerUnit = p.entry_price + (p.entry_fees_remaining ?? 0) / (p.entry_quantity_remaining ?? p.quantity);
      const closurePnlFromFill = fillPrice != null
        ? ((fillPrice - entryCostPerUnit) / entryCostPerUnit) * 100
        : null;

      // PnL realise en USD depuis l'execution
      const realizedFromExec = sellExec?.realized_pnl ?? null;

      // Tick min/max pendant la vie de la position
      const tickRange = await client.query(
        `SELECT
           MIN(t.executable_bid_vwap) AS min_bid,
           MAX(t.executable_bid_vwap) AS max_bid,
           MIN(CASE WHEN t.executable_bid_vwap IS NOT NULL THEN
             ((t.executable_bid_vwap - $2) / $2) * 100 END) AS min_trigger_pnl,
           MAX(CASE WHEN t.executable_bid_vwap IS NOT NULL THEN
             ((t.executable_bid_vwap - $2) / $2) * 100 END) AS max_trigger_pnl,
           COUNT(*)::int AS tick_count
         FROM market_position_ticks t
         WHERE t.copied_position_id = $1
           AND t.created_at BETWEEN $3 AND COALESCE($4, NOW())`,
        [p.id, p.entry_bid_vwap, p.opened_at, p.closed_at],
      );
      const tr = tickRange.rows[0] || {};

      const slThreshold = p.sl_percent; // ex 40 => -40% devrait etre le seuil
      const slBidPointsThreshold = p.sl_bid_points;
      // Si sl_bid_points est defini, le seuil en prix = entry_bid_vwap - sl_bid_points
      const slPriceThresholdBidPoints = slBidPointsThreshold != null && p.entry_bid_vwap
        ? p.entry_bid_vwap - slBidPointsThreshold
        : null;
      const slPriceThresholdPercent = slThreshold != null && p.entry_bid_vwap
        ? p.entry_bid_vwap * (1 - slThreshold / 100)
        : null;

      const row = {
        position_id: p.id,
        mode: p.mode,
        reason: p.reason,
        outcome: p.outcome,
        quantity: p.quantity,
        entry_price: p.entry_price,
        entry_bid_vwap: p.entry_bid_vwap,
        entry_fees: p.entry_fees,
        entry_fees_remaining: p.entry_fees_remaining,
        entry_cost_per_unit: entryCostPerUnit,
        sl_percent_config: slThreshold,
        sl_bid_points: slBidPointsThreshold,
        sl_price_threshold_percent: slPriceThresholdPercent,
        sl_price_threshold_bid_points: slPriceThresholdBidPoints,
        tp_percent: p.tp_percent,
        realized_pnl_position: p.realized_pnl,
        realized_pnl_exec: realizedFromExec,
        peak_closure_pnl_percent: p.peak_closure_pnl_percent,
        opened_at: p.opened_at,
        closed_at: p.closed_at,
        closing_started_at: p.closing_started_at,
        duration_sec: p.opened_at && p.closed_at
          ? Math.round((new Date(p.closed_at).getTime() - new Date(p.opened_at).getTime()) / 1000)
          : null,
        // Execution SL
        sl_exec_id: sellExec?.id ?? null,
        sl_exec_fill_price: fillPrice,
        sl_exec_fill_qty: fillQty,
        sl_exec_fees: sellExec?.fees ?? null,
        sl_exec_realized_pnl: realizedFromExec,
        sl_exec_executed_at: sellExec?.executed_at ?? null,
        sl_exec_error: sellExec?.error ?? null,
        // PnL au moment du fill
        trigger_pnl_at_fill_pct: triggerPnlAtFill,
        closure_pnl_at_fill_pct: closurePnlAtFill,
        closure_pnl_from_fill_price_pct: closurePnlFromFill,
        tick_at_fill: tickAtFill ? {
          bid_vwap: tickAtFill.executable_bid_vwap,
          best_bid: tickAtFill.best_bid,
          created_at: tickAtFill.created_at,
        } : null,
        // Range de ticks
        tick_count: tr.tick_count ?? 0,
        min_trigger_pnl_pct: tr.min_trigger_pnl ?? null,
        max_trigger_pnl_pct: tr.max_trigger_pnl ?? null,
        min_bid_vwap: tr.min_bid ?? null,
        max_bid_vwap: tr.max_bid ?? null,
        // Verdict
        sl_breached_config: slThreshold != null && triggerPnlAtFill != null
          ? triggerPnlAtFill <= -slThreshold
          : null,
        sl_breached_bid_points: slPriceThresholdBidPoints != null && tickAtFill?.executable_bid_vwap != null
          ? tickAtFill.executable_bid_vwap <= slPriceThresholdBidPoints
          : null,
        closure_pnl_vs_sl_config: slThreshold != null && closurePnlAtFill != null
          ? `${closurePnlAtFill.toFixed(2)}% vs seuil -${slThreshold}%`
          : null,
      };
      slAnalysis.push(row);
    }

    console.log(JSON.stringify(slAnalysis, null, 2));

    // Tableau synthetique
    console.log('\n--- TABLEAU SYNTHESE SL ---');
    console.table(slAnalysis.map(r => ({
      pos_id: r.position_id,
      mode: r.mode,
      reason: r.reason,
      sl_cfg_pct: r.sl_percent_config,
      sl_bid_pts: r.sl_bid_points,
      entry_price: r.entry_price,
      entry_bid_vwap: r.entry_bid_vwap,
      fill_price: r.sl_exec_fill_price,
      trigger_pnl_fill: r.trigger_pnl_at_fill_pct != null ? Number(r.trigger_pnl_at_fill_pct.toFixed(2)) : null,
      closure_pnl_fill: r.closure_pnl_at_fill_pct != null ? Number(r.closure_pnl_at_fill_pct.toFixed(2)) : null,
      closure_pnl_from_fill: r.closure_pnl_from_fill_price_pct != null ? Number(r.closure_pnl_from_fill_price_pct.toFixed(2)) : null,
      realized_pnl: r.realized_pnl_position,
      peak_pct: r.peak_closure_pnl_percent,
      min_trig_pnl: r.min_trigger_pnl_pct != null ? Number(r.min_trigger_pnl_pct.toFixed(2)) : null,
      ticks: r.tick_count,
      breached_cfg: r.sl_breached_config,
    })));

    // ============================================================
    // 3. POSITIONS FERMEES AVEC PERTE (realized_pnl < 0) MAIS PAS PAR SL
    //    (missed SL ou autres raisons)
    // ============================================================
    console.log('\n========================================================');
    console.log(' 3. POSITIONS EN PERTE NON-SL (missed SL / autres)');
    console.log('========================================================');

    const missedSl = await client.query(`
      SELECT p.id, p.condition_id, p.outcome, p.quantity, p.entry_price, p.entry_bid_vwap,
             p.entry_fees, p.entry_fees_remaining, p.entry_quantity_remaining,
             p.sl_percent, p.sl_bid_points, p.tp_percent,
             p.realized_pnl, p.peak_closure_pnl_percent, p.unrealized_pnl,
             p.opened_at, p.closed_at, p.close_reason, p.mode, p.reason,
             p.increase_count, p.liquidity_status,
             p.executable_bid_vwap, p.last_closeable_bid_vwap
      FROM copied_positions p
      WHERE p.status = 'closed'
        AND p.close_reason != 'SL'
        AND p.realized_pnl < 0
      ORDER BY p.realized_pnl ASC
    `);

    console.log(`Total positions en perte non-SL: ${missedSl.rowCount}\n`);

    const missedAnalysis: any[] = [];
    for (const p of missedSl.rows) {
      const execs = await client.query(
        `SELECT id, side, status, reason, error, fill_price, fill_quantity, fees,
                realized_pnl, executed_at
         FROM executions WHERE copied_position_id = $1 ORDER BY id`,
        [p.id],
      );
      const sellExec = execs.rows.find((e: any) => e.side === 'SELL' && e.status === 'filled') || null;

      // Tick min pendant la vie
      const tickRange = await client.query(
        `SELECT
           MIN(CASE WHEN t.executable_bid_vwap IS NOT NULL THEN
             ((t.executable_bid_vwap - $2) / $2) * 100 END) AS min_trigger_pnl,
           MAX(CASE WHEN t.executable_bid_vwap IS NOT NULL THEN
             ((t.executable_bid_vwap - $2) / $2) * 100 END) AS max_trigger_pnl,
           MIN(t.executable_bid_vwap) AS min_bid,
           COUNT(*)::int AS tick_count
         FROM market_position_ticks t
         WHERE t.copied_position_id = $1
           AND t.created_at BETWEEN $3 AND COALESCE($4, NOW())`,
        [p.id, p.entry_bid_vwap, p.opened_at, p.closed_at],
      );
      const tr = tickRange.rows[0] || {};

      const slThreshold = p.sl_percent;
      const slPriceThresholdPercent = slThreshold != null && p.entry_bid_vwap
        ? p.entry_bid_vwap * (1 - slThreshold / 100)
        : null;
      const slPriceThresholdBidPoints = p.sl_bid_points != null && p.entry_bid_vwap
        ? p.entry_bid_vwap - p.sl_bid_points
        : null;

      // Verifier si le SL aurait du etre trigger
      const minTrigPnl = tr.min_trigger_pnl != null ? parseFloat(tr.min_trigger_pnl) : null;
      const slShouldHaveTriggered = slThreshold != null && minTrigPnl != null
        ? minTrigPnl <= -slThreshold
        : null;
      const slShouldHaveTriggeredBidPts = slPriceThresholdBidPoints != null && tr.min_bid != null
        ? parseFloat(tr.min_bid) <= slPriceThresholdBidPoints
        : null;

      missedAnalysis.push({
        position_id: p.id,
        mode: p.mode,
        reason: p.reason,
        close_reason: p.close_reason,
        outcome: p.outcome,
        quantity: p.quantity,
        entry_price: p.entry_price,
        entry_bid_vwap: p.entry_bid_vwap,
        sl_percent_config: slThreshold,
        sl_bid_points: p.sl_bid_points,
        sl_price_threshold_percent: slPriceThresholdPercent,
        sl_price_threshold_bid_points: slPriceThresholdBidPoints,
        realized_pnl: p.realized_pnl,
        peak_closure_pnl_percent: p.peak_closure_pnl_percent,
        opened_at: p.opened_at,
        closed_at: p.closed_at,
        sell_fill_price: sellExec?.fill_price ?? null,
        sell_executed_at: sellExec?.executed_at ?? null,
        sell_reason: sellExec?.reason ?? null,
        tick_count: tr.tick_count ?? 0,
        min_trigger_pnl_pct: minTrigPnl != null ? Number(minTrigPnl.toFixed(2)) : null,
        max_trigger_pnl_pct: tr.max_trigger_pnl != null ? Number(parseFloat(tr.max_trigger_pnl).toFixed(2)) : null,
        min_bid_vwap: tr.min_bid != null ? Number(parseFloat(tr.min_bid).toFixed(4)) : null,
        sl_should_have_triggered: slShouldHaveTriggered,
        sl_should_have_triggered_bid_pts: slShouldHaveTriggeredBidPts,
        missed_sl: slShouldHaveTriggered === true || slShouldHaveTriggeredBidPts === true,
      });
    }

    console.log(JSON.stringify(missedAnalysis, null, 2));

    console.log('\n--- TABLEAU SYNTHESE MISSED SL ---');
    console.table(missedAnalysis.map(r => ({
      pos_id: r.position_id,
      close_reason: r.close_reason,
      sl_cfg_pct: r.sl_percent_config,
      sl_bid_pts: r.sl_bid_points,
      entry_bid_vwap: r.entry_bid_vwap,
      realized_pnl: Number(r.realized_pnl.toFixed(4)),
      min_trig_pnl: r.min_trigger_pnl_pct,
      min_bid: r.min_bid_vwap,
      sl_threshold_price: r.sl_price_threshold_percent != null ? Number(r.sl_price_threshold_percent.toFixed(4)) : null,
      should_have_sl: r.sl_should_have_triggered,
      missed_sl: r.missed_sl,
      ticks: r.tick_count,
    })));

    // ============================================================
    // 4. STATISTIQUES GLOBALES
    // ============================================================
    console.log('\n========================================================');
    console.log(' 4. STATISTIQUES GLOBALES');
    console.log('========================================================');

    const stats = await client.query(`
      SELECT
        COUNT(*)::int AS total_positions,
        COUNT(*) FILTER (WHERE status='closed')::int AS closed_positions,
        COUNT(*) FILTER (WHERE status='open')::int AS open_positions,
        COUNT(*) FILTER (WHERE status='cancelled')::int AS cancelled_positions,
        COUNT(*) FILTER (WHERE close_reason='SL')::int AS sl_closes,
        COUNT(*) FILTER (WHERE close_reason='SL' AND realized_pnl < 0)::int AS sl_losses,
        COUNT(*) FILTER (WHERE close_reason='TP')::int AS tp_closes,
        COUNT(*) FILTER (WHERE close_reason='REDEMPTION')::int AS redemption_closes,
        COUNT(*) FILTER (WHERE close_reason='COPY_CLOSE')::int AS copy_close_closes,
        COUNT(*) FILTER (WHERE close_reason='TIME_EXIT')::int AS time_exit_closes,
        COUNT(*) FILTER (WHERE status='closed' AND realized_pnl < 0 AND close_reason != 'SL')::int AS losses_not_sl,
        SUM(realized_pnl) FILTER (WHERE status='closed')::float AS total_realized_pnl,
        AVG(realized_pnl) FILTER (WHERE status='closed')::float AS avg_realized_pnl,
        SUM(realized_pnl) FILTER (WHERE close_reason='SL')::float AS sl_total_pnl,
        AVG(realized_pnl) FILTER (WHERE close_reason='SL')::float AS sl_avg_pnl,
        SUM(realized_pnl) FILTER (WHERE status='closed' AND realized_pnl < 0 AND close_reason != 'SL')::float AS missed_sl_total_pnl
      FROM copied_positions
    `);
    console.log('Global stats:');
    console.table(stats.rows);

    // SL config vs realise: comparaison
    console.log('\n--- COMPARAISON SL CONFIG vs CLOSURE PnL AU FILL ---');
    for (const r of slAnalysis) {
      const cfg = r.sl_percent_config;
      const actual = r.closure_pnl_at_fill_pct;
      const fromFill = r.closure_pnl_from_fill_price_pct;
      const minTrig = r.min_trigger_pnl_pct;
      console.log(
        `Pos ${r.position_id}: SL_config=${cfg}% | trigger_pnl_at_fill=${r.trigger_pnl_at_fill_pct?.toFixed(2)}% | ` +
        `closure_pnl_at_fill=${actual?.toFixed(2)}% | closure_from_fill=${fromFill?.toFixed(2)}% | ` +
        `min_trigger_pnl=${minTrig?.toFixed(2)}% | realized=${r.realized_pnl_position} | ` +
        `breached=${r.sl_breached_config}`,
      );
    }

    // ============================================================
    // 5. VERDICT: pourquoi SL ferme a des niveaux bien au-dessus du seuil?
    // ============================================================
    console.log('\n========================================================');
    console.log(' 5. ANALYSE: SL ferme a des niveaux bien au-dessus du seuil');
    console.log('========================================================');
    console.log('Hypothese: sl_percent est en CLOSURE PnL (apres fees) non en TRIGGER PnL.');
    console.log('Ou bien: sl_bid_points (crypto-algo) override sl_percent.');
    console.log('');
    for (const r of slAnalysis) {
      const cfg = r.sl_percent_config;
      const bidPts = r.sl_bid_points;
      const actual = r.closure_pnl_at_fill_pct;
      console.log(
        `Pos ${r.position_id} [${r.reason}] sl_pct=${cfg} sl_bid_pts=${bidPts} ` +
        `entry_bid_vwap=${r.entry_bid_vwap} entry_price=${r.entry_price} ` +
        `closure_pnl_fill=${actual?.toFixed(2)}% trigger_pnl_fill=${r.trigger_pnl_at_fill_pct?.toFixed(2)}%`,
      );
      if (bidPts != null && r.entry_bid_vwap) {
        const threshold = r.entry_bid_vwap - bidPts;
        const thresholdPct = -((bidPts / r.entry_bid_vwap) * 100);
        console.log(`  -> seuil bid_points: prix=${threshold.toFixed(4)} (= ${thresholdPct.toFixed(2)}% du bid_vwap)`);
      }
      if (cfg != null && r.entry_bid_vwap) {
        const threshold = r.entry_bid_vwap * (1 - cfg / 100);
        console.log(`  -> seuil sl_percent: prix=${threshold.toFixed(4)} (= -${cfg}% du bid_vwap)`);
      }
    }

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});