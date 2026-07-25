import pg from 'pg';
import { loadMonorepoEnv } from '../packages/core/src/config/env.js';

loadMonorepoEnv();
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function detail(positionId: number) {
  const c = await pool.connect();
  try {
    const p = (
      await c.query(
        `SELECT id, entry_bid_vwap, sl_bid_points, close_reason, peak_closure_pnl_percent, opened_at, closed_at
         FROM copied_positions WHERE id=$1`,
        [positionId],
      )
    ).rows[0];
    const slThreshold = Number(p.entry_bid_vwap) - Number(p.sl_bid_points);

    const lowTicks = await c.query(
      `
      SELECT created_at, executable_bid_vwap, best_bid, last_trade_price
      FROM market_position_ticks
      WHERE copied_position_id=$1
        AND executable_bid_vwap IS NOT NULL
        AND executable_bid_vwap <= $2
      ORDER BY created_at
      LIMIT 10
      `,
      [positionId, slThreshold],
    );

    const lowTicksFiltered = await c.query(
      `
      SELECT created_at, executable_bid_vwap, best_bid, last_trade_price
      FROM market_position_ticks
      WHERE copied_position_id=$1
        AND executable_bid_vwap IS NOT NULL
        AND executable_bid_vwap >= 0.05
        AND executable_bid_vwap <= $2
      ORDER BY created_at
      LIMIT 10
      `,
      [positionId, slThreshold],
    );

    console.log(`\n=== POSITION #${positionId} slThreshold=${slThreshold.toFixed(4)} peak=${p.peak_closure_pnl_percent} close=${p.close_reason} ===`);
    console.log('Low VWAP ticks (all, incl. anomalies):', lowTicks.rows.length);
    lowTicks.rows.forEach((r) =>
      console.log(`  ${r.created_at.toISOString()} vwap=${r.executable_bid_vwap} bid=${r.best_bid}`),
    );
    console.log('Low VWAP ticks (vwap >= 0.05):', lowTicksFiltered.rows.length);
    lowTicksFiltered.rows.forEach((r) =>
      console.log(`  ${r.created_at.toISOString()} vwap=${r.executable_bid_vwap} bid=${r.best_bid}`),
    );
  } finally {
    c.release();
  }
}

async function main() {
  for (const id of [18018, 18021, 18023, 18019, 18022]) {
    await detail(id);
  }
  await pool.end();
}

main().catch(console.error);
