import pg from 'pg';
import { loadMonorepoEnv } from '../packages/core/src/config/env.js';

loadMonorepoEnv();

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const client = await pool.connect();

  try {
    // 1. Execution failure reasons
    console.log('=== EXECUTION FAILURES BY REASON ===');
    const failReasonsRes = await client.query(`
      SELECT reason, COUNT(*) as cnt
      FROM executions
      WHERE mode='sim' AND status='failed'
      GROUP BY reason
      ORDER BY cnt DESC
    `);
    console.log(JSON.stringify(failReasonsRes.rows, null, 2));

    // 2. Sample failed executions with errors
    console.log('\n=== SAMPLE FAILED EXECUTIONS (first 10) ===');
    const failedExecsRes = await client.query(`
      SELECT id, copied_position_id, side, reason, status, error, requested_qty, fill_price, executed_at
      FROM executions
      WHERE mode='sim' AND status='failed'
      ORDER BY id
      LIMIT 10
    `);
    console.log(JSON.stringify(failedExecsRes.rows, null, 2));

    // 3. RiskConfig
    console.log('\n=== RISK CONFIG ===');
    const riskRes = await client.query('SELECT * FROM risk_config LIMIT 1');
    const risk = riskRes.rows[0];
    if (risk) {
      const keys = [
        'sim_initial_capital', 'sizing_mode', 'copy_ratio', 'entry_usdc_amount',
        'sim_min_bid_to_ask_ratio', 'sim_momentum_filter_enabled',
        'sim_signal_score_sizing_enabled', 'sl_tp_enabled', 'sl_percent', 'tp_percent',
        'trailing_enabled', 'trailing_stop_percent', 'trailing_activation_percent',
        'copy_increase_enabled', 'copy_decrease_enabled', 'max_increases_per_position',
        'sim_copy_increase_sl_proximity_enabled', 'sim_copy_increase_sl_proximity_percent',
        'sim_allowed_market_tags', 'real_trading_enabled'
      ];
      for (const k of keys) {
        console.log(`  ${k}: ${risk[k]}`);
      }
    }

    // 4. Distribution of close reasons for closed positions
    console.log('\n=== CLOSED POSITIONS BY CLOSE_REASON ===');
    const closeReasonsRes = await client.query(`
      SELECT close_reason, COUNT(*) as cnt, SUM(realized_pnl) as total_pnl, AVG(realized_pnl) as avg_pnl
      FROM copied_positions
      WHERE mode='sim' AND status='closed'
      GROUP BY close_reason
      ORDER BY cnt DESC
    `);
    console.log(JSON.stringify(closeReasonsRes.rows, null, 2));

    // 5. Win rate by close reason
    console.log('\n=== WIN RATE BY CLOSE_REASON ===');
    for (const cr of closeReasonsRes.rows) {
      const winCountRes = await client.query(`
        SELECT COUNT(*) as wins FROM copied_positions
        WHERE mode='sim' AND status='closed' AND close_reason=$1 AND realized_pnl > 0
      `, [cr.close_reason]);
      const wins = Number(winCountRes.rows[0]?.wins ?? 0);
      const cnt = Number(cr.cnt);
      console.log(`  ${cr.close_reason}: ${wins}/${cnt} wins (${((wins / cnt) * 100).toFixed(1)}%)`);
    }

    // 6. Check cancelled positions - why so many?
    console.log('\n=== CANCELLED POSITIONS ANALYSIS ===');
    const cancelledRes = await client.query(`
      SELECT id, condition_id, quantity, entry_price, entry_fees, status, opened_at
      FROM copied_positions
      WHERE mode='sim' AND status='cancelled'
      ORDER BY id DESC
      LIMIT 10
    `);
    console.log(JSON.stringify(cancelledRes.rows, null, 2));

    // 7. Check position status distribution for all sim
    console.log('\n=== ALL SIM POSITION STATUSES ===');
    const statusDistRes = await client.query(`
      SELECT status, COUNT(*) as cnt
      FROM copied_positions
      WHERE mode='sim'
      GROUP BY status
      ORDER BY cnt DESC
    `);
    console.log(JSON.stringify(statusDistRes.rows, null, 2));
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});