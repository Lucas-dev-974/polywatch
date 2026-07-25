import pg from 'pg';
import { loadMonorepoEnv } from '../packages/core/src/config/env.js';

loadMonorepoEnv();

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const c = await pool.connect();
  try {
    // 1. Risk config complète
    const rc = await c.query('SELECT * FROM risk_config LIMIT 1');
    console.log('=== RISK CONFIG COMPLETE ===');
    console.log(JSON.stringify(rc.rows[0], null, 2));

    // 2. Toutes les positions copy trading
    const pos = await c.query(`
      SELECT id, status, mode, reason, close_reason, sl_percent, tp_percent, 
             entry_price, entry_bid_vwap, realized_pnl, peak_closure_pnl_percent, 
             opened_at, closed_at, sl_bid_points, tp_bid_points
      FROM copied_positions 
      ORDER BY id
    `);
    console.log('\n=== ALL POSITIONS ===');
    pos.rows.forEach(r => console.log(JSON.stringify(r)));

    // 3. Toutes les executions
    const execs = await c.query(`
      SELECT id, copied_position_id, side, status, reason, fill_price, realized_pnl, error, executed_at
      FROM executions 
      ORDER BY id
    `);
    console.log('\n=== ALL EXECUTIONS ===');
    execs.rows.forEach(r => console.log(JSON.stringify(r)));

    // 4. Market_position_ticks count
    const ticks = await c.query('SELECT COUNT(*)::int AS cnt FROM market_position_ticks');
    console.log('\n=== MARKET_POSITION_TICKS count: ' + ticks.rows[0].cnt);

    // 5. Analyse SL : positions avec close_reason=SL
    const slPositions = pos.rows.filter((p: any) => p.close_reason === 'SL');
    console.log('\n=== POSITIONS CLOSED BY SL ===');
    slPositions.forEach((p: any) => {
      console.log(`id=${p.id} sl=${p.sl_percent}% entry=${p.entry_price} entryBid=${p.entry_bid_vwap} realized=${p.realized_pnl} peak=${p.peak_closure_pnl_percent}`);
    });

    // 6. Analyse : positions fermées avec realized_pnl négatif mais PAS par SL
    const missedSl = pos.rows.filter((p: any) => 
      p.status === 'closed' && 
      p.close_reason !== 'SL' && 
      p.realized_pnl != null && p.realized_pnl < 0
    );
    console.log('\n=== CLOSED WITH LOSS BUT NOT BY SL ===');
    missedSl.forEach((p: any) => console.log(JSON.stringify(p)));

    // 7. Vérifier les ticks pour les positions qui auraient dû trigger SL
    console.log('\n=== SL COMPLIANCE CHECK (via ticks) ===');
    for (const p of pos.rows.filter((p: any) => p.status === 'closed' && p.sl_percent != null)) {
      const sl = Number(p.sl_percent);
      if (sl <= 0) continue;
      
      const ticksRes = await c.query(`
        SELECT MIN(
          CASE WHEN $2::real > 0 THEN ((t.executable_bid_vwap - $2::real) / $2::real) * 100
               WHEN t.best_bid > 0 AND $3::real > 0 THEN ((t.best_bid - $3::real) / $3::real) * 100
               ELSE NULL END
        ) AS min_trigger_pnl,
        MIN(
          CASE WHEN $3::real > 0 AND t.executable_bid_vwap IS NOT NULL THEN
            ((t.executable_bid_vwap - ($3::real + COALESCE($4::real,0)/NULLIF(COALESCE($5::real, $6::real),0))) /
             ($3::real + COALESCE($4::real,0)/NULLIF(COALESCE($5::real, $6::real),0))) * 100
          ELSE NULL END
        ) AS min_closure_pnl,
        COUNT(*)::int AS tick_count
        FROM market_position_ticks t
        WHERE t.copied_position_id = $1
          AND t.created_at BETWEEN $7::timestamptz AND COALESCE($8::timestamptz, NOW())
      `, [
        p.id, p.entry_bid_vwap, p.entry_price, 
        p.entry_fees_remaining || 0, p.entry_quantity_remaining, p.quantity,
        p.opened_at, p.closed_at
      ]);
      
      const t = ticksRes.rows[0];
      if (!t || t.tick_count === 0) continue;
      
      const minTrigger = t.min_trigger_pnl != null ? Number(t.min_trigger_pnl) : null;
      const minClosure = t.min_closure_pnl != null ? Number(t.min_closure_pnl) : null;
      const slBreached = (minTrigger != null && minTrigger <= -sl) || (minClosure != null && minClosure <= -sl);
      
      if (slBreached && p.close_reason !== 'SL') {
        console.log(`VIOLATION: pos=${p.id} close=${p.close_reason} sl=${sl}% minTrigger=${minTrigger?.toFixed(2)}% minClosure=${minClosure?.toFixed(2)}% ticks=${t.tick_count}`);
      }
    }

    // 8. Analyse des positions pending (copy trading)
    const pending = pos.rows.filter((p: any) => p.status === 'pending');
    console.log('\n=== PENDING POSITIONS ===');
    pending.forEach((p: any) => console.log(JSON.stringify(p)));

  } finally {
    c.release();
    await pool.end();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
