import pg from 'pg';
import { loadMonorepoEnv } from '../packages/core/src/config/env.js';

loadMonorepoEnv();

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const c = await pool.connect();
  try {
    // Analyse détaillée des positions SL
    const slPositions = [7068, 16323];
    
    for (const posId of slPositions) {
      console.log(`\n${'='.repeat(70)}`);
      console.log(`POSITION ${posId} — Analyse SL`);
      console.log(`${'='.repeat(70)}`);
      
      const pos = (await c.query(`
        SELECT p.*, m.slug, m.end_date, m.accepting_orders, m.closed as market_closed
        FROM copied_positions p
        LEFT JOIN markets m ON m.condition_id = p.condition_id
        WHERE p.id = $1
      `, [posId])).rows[0];
      
      console.log('Position:', {
        id: pos.id,
        mode: pos.mode,
        reason: pos.reason,
        close_reason: pos.close_reason,
        sl_percent: pos.sl_percent,
        tp_percent: pos.tp_percent,
        sl_bid_points: pos.sl_bid_points,
        tp_bid_points: pos.tp_bid_points,
        entry_price: pos.entry_price,
        entry_bid_vwap: pos.entry_bid_vwap,
        realized_pnl: pos.realized_pnl,
        peak_closure_pnl_percent: pos.peak_closure_pnl_percent,
        opened_at: pos.opened_at,
        closed_at: pos.closed_at,
        slug: pos.slug,
      });
      
      // Ticks autour du moment de la fermeture
      const ticks = await c.query(`
        SELECT t.created_at,
               t.best_bid, t.executable_bid_vwap, t.last_trade_price,
               EXTRACT(EPOCH FROM (t.created_at - $2::timestamptz))::int AS ms_since_open,
               CASE WHEN $3::real > 0 AND t.executable_bid_vwap IS NOT NULL THEN
                 ((t.executable_bid_vwap - $3::real) / $3::real) * 100
               ELSE NULL END AS trigger_pnl_pct,
               CASE WHEN $4::real > 0 AND t.executable_bid_vwap IS NOT NULL THEN
                 ((t.executable_bid_vwap - ($4::real + COALESCE($5::real,0)/NULLIF(COALESCE($6::real, $7::real),0))) /
                  ($4::real + COALESCE($5::real,0)/NULLIF(COALESCE($6::real, $7::real),0))) * 100
               ELSE NULL END AS closure_pnl_pct
        FROM market_position_ticks t
        WHERE t.copied_position_id = $1
          AND t.created_at BETWEEN $2::timestamptz - interval '5 seconds' AND $2::timestamptz + interval '5 seconds'
        ORDER BY t.created_at
      `, [
        posId, pos.opened_at,
        pos.entry_bid_vwap, pos.entry_price,
        pos.entry_fees_remaining || 0, pos.entry_quantity_remaining, pos.quantity
      ]);
      
      console.log(`\nTicks ±5s autour de l'ouverture (${ticks.rows.length} ticks):`);
      ticks.rows.forEach(t => {
        const trigger = t.trigger_pnl_pct != null ? Number(t.trigger_pnl_pct).toFixed(2) : 'NULL';
        const closure = t.closure_pnl_pct != null ? Number(t.closure_pnl_pct).toFixed(2) : 'NULL';
        console.log(`  +${t.ms_since_open}ms bid=${t.best_bid} execBid=${t.executable_bid_vwap} lastTrade=${t.last_trade_price} trigger=${trigger}% closure=${closure}%`);
      });
      
      // Ticks après fermeture
      if (pos.closed_at) {
        const ticksAfter = await c.query(`
          SELECT t.created_at,
                 t.best_bid, t.executable_bid_vwap, t.last_trade_price,
                 EXTRACT(EPOCH FROM (t.created_at - $2::timestamptz))::int AS ms_since_close
          FROM market_position_ticks t
          WHERE t.copied_position_id = $1
            AND t.created_at BETWEEN $2::timestamptz AND $2::timestamptz + interval '5 seconds'
          ORDER BY t.created_at
          LIMIT 10
        `, [posId, pos.closed_at]);
        
        console.log(`\nTicks après fermeture (${ticksAfter.rows.length}):`);
        ticksAfter.rows.forEach(t => {
          console.log(`  +${t.ms_since_close}ms bid=${t.best_bid} execBid=${t.executable_bid_vwap} lastTrade=${t.last_trade_price}`);
        });
      }
      
      // Tous les ticks de la position (min/max)
      const tickStats = await c.query(`
        SELECT 
          COUNT(*)::int AS total_ticks,
          MIN(t.executable_bid_vwap) AS min_exec_bid,
          MAX(t.executable_bid_vwap) AS max_exec_bid,
          MIN(t.best_bid) AS min_best_bid,
          MAX(t.best_bid) AS max_best_bid,
          MIN(t.last_trade_price) AS min_last_trade,
          MAX(t.last_trade_price) AS max_last_trade,
          MIN(
            CASE WHEN $2::real > 0 AND t.executable_bid_vwap IS NOT NULL THEN
              ((t.executable_bid_vwap - $2::real) / $2::real) * 100
            ELSE NULL END
          ) AS min_trigger_pnl,
          MIN(
            CASE WHEN $3::real > 0 AND t.executable_bid_vwap IS NOT NULL THEN
              ((t.executable_bid_vwap - ($3::real + COALESCE($4::real,0)/NULLIF(COALESCE($5::real, $6::real),0))) /
               ($3::real + COALESCE($4::real,0)/NULLIF(COALESCE($5::real, $6::real),0))) * 100
            ELSE NULL END
          ) AS min_closure_pnl
        FROM market_position_ticks t
        WHERE t.copied_position_id = $1
          AND t.created_at BETWEEN $7::timestamptz AND COALESCE($8::timestamptz, NOW())
      `, [
        posId, pos.entry_bid_vwap, pos.entry_price,
        pos.entry_fees_remaining || 0, pos.entry_quantity_remaining, pos.quantity,
        pos.opened_at, pos.closed_at
      ]);
      
      console.log(`\nTick stats (toute la vie de la position):`);
      console.log(JSON.stringify(tickStats.rows[0], null, 2));
      
      // Executions
      const execs = await c.query(`
        SELECT id, side, status, reason, fill_price, realized_pnl, error, executed_at
        FROM executions WHERE copied_position_id = $1 ORDER BY id
      `, [posId]);
      
      console.log(`\nExecutions:`);
      execs.rows.forEach(e => {
        console.log(`  #${e.id} ${e.side} [${e.status}] reason=${e.reason} fill=${e.fill_price} realized=${e.realized_pnl} error=${e.error} at=${e.executed_at}`);
      });
    }
    
    // Vérification: est-ce que shouldUseConservativeExitMark est toujours true pour les positions en perte?
    console.log(`\n${'='.repeat(70)}`);
    console.log(`ANALYSE: shouldUseConservativeExitMark`);
    console.log(`${'='.repeat(70)}`);
    
    // Pour position 16323: entry=0.38, entryBid=0.37, trigger=0%, closure=-2.63%
    // shouldUseConservativeExitMark({trigger:0, closure:-2.63, ...}) → closure<0 → true
    // Donc le conservative mark est utilisé
    // resolveExitDecisionMarkPrice prend le MIN de tous les candidats
    // Si lastTradePrice est bas (ex: 0.22), le conservative mark = 0.22
    // trigger PnL = (0.22-0.37)/0.37 = -40.5% → SL FIRE!
    
    console.log('Hypothèse: Le conservative mark (MIN des candidats) cause un SL prématuré');
    console.log('quand lastTradePrice est bas et que la position est en petite perte.');
    console.log('shouldUseConservativeExitMark retourne true dès que trigger<0 OU closure<0.');
    console.log('Donc TOUTE position en perte (même -0.1%) utilise le conservative mark.');
    console.log('Si lastTradePrice est bas (stale), le conservative mark = lastTradePrice bas.');
    console.log('→ SL trigger sur un prix qui ne reflète pas le marché actuel.');
    
    // Vérifier les lastTradePrice pour les positions SL
    console.log(`\n${'='.repeat(70)}`);
    console.log(`VÉRIFICATION: lastTradePrice dans les ticks`);
    console.log(`${'='.repeat(70)}`);
    
    for (const posId of slPositions) {
      const pos = (await c.query('SELECT * FROM copied_positions WHERE id=$1', [posId])).rows[0];
      
      const ltpTicks = await c.query(`
        SELECT t.created_at, t.last_trade_price, t.executable_bid_vwap, t.best_bid,
               EXTRACT(EPOCH FROM (t.created_at - $2::timestamptz))::int AS ms_since_open
        FROM market_position_ticks t
        WHERE t.copied_position_id = $1
          AND t.last_trade_price IS NOT NULL
          AND t.created_at BETWEEN $2::timestamptz - interval '2 seconds' AND $2::timestamptz + interval '2 seconds'
        ORDER BY t.created_at
        LIMIT 20
      `, [posId, pos.opened_at]);
      
      console.log(`\nPosition ${posId} — lastTradePrice autour de l'ouverture:`);
      ltpTicks.rows.forEach(t => {
        console.log(`  +${t.ms_since_open}ms lastTrade=${t.last_trade_price} execBid=${t.executable_bid_vwap} bestBid=${t.best_bid}`);
      });
    }
    
  } finally {
    c.release();
    await pool.end();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
