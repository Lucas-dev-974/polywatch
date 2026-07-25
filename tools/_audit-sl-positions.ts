import pg from 'pg';
import { loadMonorepoEnv } from '../packages/core/src/config/env.js';

loadMonorepoEnv();

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const c = await pool.connect();
  try {
    // 1. Vérifier les ticks pour les positions SL
    console.log('=== TICKS POUR POSITIONS SL ===');
    for (const posId of [7068, 16323]) {
      const cnt = await c.query(
        'SELECT COUNT(*)::int AS cnt FROM market_position_ticks WHERE copied_position_id=$1',
        [posId]
      );
      console.log(`Position ${posId}: ${cnt.rows[0].cnt} ticks`);
      
      if (cnt.rows[0].cnt > 0) {
        const ticks = await c.query(`
          SELECT created_at, best_bid, executable_bid_vwap, last_trade_price
          FROM market_position_ticks WHERE copied_position_id=$1 ORDER BY created_at LIMIT 5
        `, [posId]);
        ticks.rows.forEach(t => console.log(`  ${t.created_at}: bid=${t.best_bid} execBid=${t.executable_bid_vwap} lastTrade=${t.last_trade_price}`));
      }
    }

    // 2. Vérifier les positions ouvertes actuelles (sim copy trading)
    console.log('\n=== POSITIONS OUVERTES SIM COPY ===');
    const open = await c.query(`
      SELECT p.id, p.sl_percent, p.tp_percent, p.entry_price, p.entry_bid_vwap,
             p.peak_closure_pnl_percent, p.unrealized_pnl, p.opened_at,
             m.slug, m.end_date
      FROM copied_positions p
      LEFT JOIN markets m ON m.condition_id = p.condition_id
      WHERE p.mode='sim' AND p.reason='COPY_OPEN' AND p.status='open'
      ORDER BY p.id
    `);
    open.rows.forEach(p => {
      console.log(`id=${p.id} sl=${p.sl_percent}% entry=${p.entry_price} entryBid=${p.entry_bid_vwap} peak=${p.peak_closure_pnl_percent} unrealized=${p.unrealized_pnl} slug=${p.slug}`);
    });

    // 3. Vérifier les dernières positions fermées par SL en sim
    console.log('\n=== DERNIÈRES POSITIONS FERMÉES PAR SL (sim) ===');
    const recentSl = await c.query(`
      SELECT p.id, p.sl_percent, p.entry_price, p.entry_bid_vwap, p.realized_pnl,
             p.peak_closure_pnl_percent, p.opened_at, p.closed_at,
             EXTRACT(EPOCH FROM (p.closed_at - p.opened_at))::int AS duration_ms,
             m.slug
      FROM copied_positions p
      LEFT JOIN markets m ON m.condition_id = p.condition_id
      WHERE p.mode='sim' AND p.close_reason='SL'
      ORDER BY p.closed_at DESC
      LIMIT 20
    `);
    recentSl.rows.forEach(p => {
      const triggerPnl = p.entry_bid_vwap > 0 
        ? ((p.entry_bid_vwap - p.entry_bid_vwap) / p.entry_bid_vwap) * 100 
        : null;
      console.log(`id=${p.id} sl=${p.sl_percent}% entry=${p.entry_price} entryBid=${p.entry_bid_vwap} realized=${p.realized_pnl} peak=${p.peak_closure_pnl_percent} duration=${p.duration_ms}ms slug=${p.slug}`);
    });

    // 4. Vérifier les positions fermées par SL en real
    console.log('\n=== DERNIÈRES POSITIONS FERMÉES PAR SL (real) ===');
    const realSl = await c.query(`
      SELECT p.id, p.sl_percent, p.entry_price, p.entry_bid_vwap, p.realized_pnl,
             p.peak_closure_pnl_percent, p.opened_at, p.closed_at,
             EXTRACT(EPOCH FROM (p.closed_at - p.opened_at))::int AS duration_ms,
             m.slug
      FROM copied_positions p
      LEFT JOIN markets m ON m.condition_id = p.condition_id
      WHERE p.mode='real' AND p.close_reason='SL'
      ORDER BY p.closed_at DESC
      LIMIT 20
    `);
    realSl.rows.forEach(p => {
      console.log(`id=${p.id} sl=${p.sl_percent}% entry=${p.entry_price} entryBid=${p.entry_bid_vwap} realized=${p.realized_pnl} peak=${p.peak_closure_pnl_percent} duration=${p.duration_ms}ms slug=${p.slug}`);
    });

    // 5. Vérifier les executions SL pour voir les fill prices
    console.log('\n=== EXECUTIONS SL RÉCENTES ===');
    const slExecs = await c.query(`
      SELECT e.id, e.copied_position_id, e.fill_price, e.realized_pnl, e.executed_at,
             p.sl_percent, p.entry_price, p.entry_bid_vwap, p.mode
      FROM executions e
      JOIN copied_positions p ON p.id = e.copied_position_id
      WHERE e.reason='SL' AND e.status='filled'
      ORDER BY e.id DESC
      LIMIT 20
    `);
    slExecs.rows.forEach(e => {
      const triggerPnl = e.entry_bid_vwap > 0 
        ? ((Number(e.fill_price) - Number(e.entry_bid_vwap)) / Number(e.entry_bid_vwap)) * 100 
        : null;
      const closurePnl = e.entry_price > 0
        ? ((Number(e.fill_price) - Number(e.entry_price)) / Number(e.entry_price)) * 100
        : null;
      console.log(`pos=${e.copied_position_id} mode=${e.mode} sl=${e.sl_percent}% fill=${e.fill_price} triggerPnl=${triggerPnl?.toFixed(2)}% closurePnl=${closurePnl?.toFixed(2)}% realized=${e.realized_pnl}`);
    });

    // 6. Vérifier les positions avec peak négatif mais pas fermées par SL
    console.log('\n=== POSITIONS AVEC PEAK < -SL% MAIS PAS SL ===');
    const missedSl = await c.query(`
      SELECT p.id, p.mode, p.close_reason, p.sl_percent, p.peak_closure_pnl_percent,
             p.realized_pnl, p.entry_price, p.entry_bid_vwap
      FROM copied_positions p
      WHERE p.status='closed' AND p.close_reason != 'SL'
        AND p.sl_percent IS NOT NULL AND p.sl_percent > 0
        AND p.peak_closure_pnl_percent IS NOT NULL
        AND p.peak_closure_pnl_percent <= -p.sl_percent
      ORDER BY p.id
    `);
    missedSl.rows.forEach(p => {
      console.log(`id=${p.id} mode=${p.mode} close=${p.close_reason} sl=${p.sl_percent}% peak=${p.peak_closure_pnl_percent} realized=${p.realized_pnl}`);
    });

  } finally {
    c.release();
    await pool.end();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
