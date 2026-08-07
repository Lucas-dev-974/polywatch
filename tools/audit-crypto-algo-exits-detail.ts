import pg from 'pg';
import { loadMonorepoEnv } from '../packages/core/src/config/env.js';

loadMonorepoEnv();

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const client = await pool.connect();

  try {
    console.log('=== REDEMPTION POSITIONS DETAIL ===');
    const red = await client.query(`
      SELECT p.id, m.slug, p.close_reason, p.realized_pnl, p.peak_closure_pnl_percent,
             p.sl_percent, p.opened_at, p.closed_at, m.end_date, m.resolved, m.winning_token_id,
             EXTRACT(EPOCH FROM (m.end_date - p.opened_at))::int AS sec_to_end_at_open,
             EXTRACT(EPOCH FROM (p.closed_at - m.end_date))::int AS sec_after_end_at_close
      FROM copied_positions p
      LEFT JOIN markets m ON m.condition_id = p.condition_id
      WHERE p.mode='sim' AND p.reason='ALGO_OPEN' AND p.close_reason='REDEMPTION'
      ORDER BY p.id
    `);
    console.table(red.rows);

    for (const p of red.rows) {
      const ex = await client.query(
        `SELECT id, side, status, reason, error, fill_price, realized_pnl, executed_at
         FROM executions WHERE copied_position_id=$1 ORDER BY id`,
        [p.id],
      );
      console.log(`Execs pos ${p.id}:`, ex.rows);
    }

    console.log('\n=== PRE_CLOSE WITH PEAK >= TP (50%) ===');
    const te = await client.query(`
      SELECT p.id, m.slug, p.peak_closure_pnl_percent, p.realized_pnl, p.entry_price, p.closed_at
      FROM copied_positions p
      LEFT JOIN markets m ON m.condition_id = p.condition_id
      WHERE p.mode='sim' AND p.reason='ALGO_OPEN'
        AND p.close_reason IN ('PRE_CLOSE_LOSS','PRE_CLOSE_WIN')
        AND p.peak_closure_pnl_percent >= 50
      ORDER BY p.peak_closure_pnl_percent DESC
    `);
    console.table(te.rows);

    console.log('\n=== SL WITH POSITIVE REALIZED PNL ===');
    const slPos = await client.query(`
      SELECT p.id, m.slug, p.realized_pnl, p.peak_closure_pnl_percent, p.entry_price, p.sl_percent
      FROM copied_positions p
      LEFT JOIN markets m ON m.condition_id = p.condition_id
      WHERE p.mode='sim' AND p.reason='ALGO_OPEN' AND p.close_reason='SL' AND p.realized_pnl > 0
    `);
    console.table(slPos.rows);
    for (const p of slPos.rows) {
      const ex = await client.query(
        `SELECT id, side, status, reason, fill_price, realized_pnl, executed_at
         FROM executions WHERE copied_position_id=$1 ORDER BY id`,
        [p.id],
      );
      console.log(`Executions pos ${p.id}:`, ex.rows);
    }

    console.log('\n=== NEGATIVE REALIZED BUT NOT CLOSED BY SL ===');
    const missed = await client.query(`
      SELECT p.id, m.slug, p.close_reason, p.realized_pnl, p.peak_closure_pnl_percent, p.sl_percent
      FROM copied_positions p
      LEFT JOIN markets m ON m.condition_id = p.condition_id
      WHERE p.mode='sim' AND p.reason='ALGO_OPEN' AND p.status='closed'
        AND p.close_reason NOT IN ('SL')
        AND p.realized_pnl < -1.5
      ORDER BY p.realized_pnl
    `);
    console.table(missed.rows);

    for (const p of missed.rows) {
      const ticks = await client.query(
        `
        SELECT MIN(
          CASE WHEN p2.entry_bid_vwap > 0 THEN ((t.executable_bid_vwap - p2.entry_bid_vwap) / p2.entry_bid_vwap) * 100 ELSE NULL END
        ) AS min_trigger_pnl,
        MIN(
          CASE WHEN p2.entry_price > 0 AND t.executable_bid_vwap IS NOT NULL THEN
            ((t.executable_bid_vwap - (p2.entry_price + COALESCE(p2.entry_fees_remaining,0)/NULLIF(COALESCE(p2.entry_quantity_remaining, p2.quantity),0))) /
             (p2.entry_price + COALESCE(p2.entry_fees_remaining,0)/NULLIF(COALESCE(p2.entry_quantity_remaining, p2.quantity),0))) * 100
          ELSE NULL END
        ) AS min_closure_pnl
        FROM market_position_ticks t
        JOIN copied_positions p2 ON p2.id = t.copied_position_id
        WHERE t.copied_position_id = $1
          AND t.created_at BETWEEN p2.opened_at AND COALESCE(p2.closed_at, NOW())
        `,
        [p.id],
      );
      console.log(`Tick min PnL pos ${p.id}:`, ticks.rows[0]);
    }

    console.log('\n=== PRE-CLOSE: why zero signals? ===');
    console.log('Config: crypto_algo_pre_close_enabled=true, seconds=null (? 120s for 5m)');
    console.log('hold_if_winning=true ? winning positions skip PRE_CLOSE_LOSS');

    const winningAtEnd = await client.query(`
      SELECT p.id, m.slug, p.close_reason, p.peak_closure_pnl_percent, p.realized_pnl,
             EXTRACT(EPOCH FROM (m.end_date - p.opened_at))::int AS sec_to_end
      FROM copied_positions p
      LEFT JOIN markets m ON m.condition_id = p.condition_id
      WHERE p.mode='sim' AND p.reason='ALGO_OPEN' AND p.status='closed'
        AND p.peak_closure_pnl_percent >= 0
      ORDER BY p.close_reason, p.id
    `);
    console.log('\nClosed positions with peak >= 0 (would be held by pre_close_hold_if_winning):');
    console.table(winningAtEnd.rows);

    const bal = await client.query('SELECT * FROM simulation_balances');
    console.log('\n=== SIM BALANCE ===', bal.rows[0]);

    const cancelled = await client.query(`
      SELECT p.id, m.slug, p.status, p.opened_at
      FROM copied_positions p
      LEFT JOIN markets m ON m.condition_id = p.condition_id
      WHERE p.mode='sim' AND p.reason='ALGO_OPEN' AND p.status='cancelled'
    `);
    console.log('\n=== CANCELLED POSITIONS ===');
    console.table(cancelled.rows);

    const failedBuys = await client.query(`
      SELECT e.id, e.copied_position_id, e.error, e.executed_at, p.status
      FROM executions e
      JOIN copied_positions p ON p.id = e.copied_position_id
      WHERE p.mode='sim' AND p.reason='ALGO_OPEN' AND e.side='BUY' AND e.status='failed'
    `);
    console.log('\n=== FAILED ALGO OPEN BUYS ===');
    console.table(failedBuys.rows);

    const tickCoverage = await client.query(`
      SELECT p.id, p.close_reason, p.opened_at,
        (SELECT COUNT(*)::int FROM market_position_ticks t WHERE t.copied_position_id = p.id) AS tick_count
      FROM copied_positions p
      WHERE p.mode='sim' AND p.reason='ALGO_OPEN'
      ORDER BY p.id
    `);
    console.log('\n=== TICK COVERAGE PER POSITION ===');
    console.table(tickCoverage.rows);

    const peakNotTp = await client.query(`
      SELECT p.id, m.slug, p.close_reason, p.peak_closure_pnl_percent, p.tp_percent, p.realized_pnl
      FROM copied_positions p
      LEFT JOIN markets m ON m.condition_id = p.condition_id
      WHERE p.mode='sim' AND p.reason='ALGO_OPEN'
        AND p.peak_closure_pnl_percent >= 50 AND p.close_reason != 'TP'
      ORDER BY p.peak_closure_pnl_percent DESC
    `);
    console.log('\n=== PEAK >= TP% BUT CLOSED VIA OTHER REASON ===');
    console.table(peakNotTp.rows);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
