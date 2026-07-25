import pg from 'pg';
import { loadMonorepoEnv } from '../packages/core/src/config/env.js';

loadMonorepoEnv();

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const client = await pool.connect();

  try {
    // Check actual RiskConfig values
    const rcRes = await client.query('SELECT * FROM risk_config LIMIT 1');
    const rc = rcRes.rows[0];
    console.log('=== RISK CONFIG ACTUEL ===');
    const keys = [
      'sim_sizing_mode', 'sim_copy_ratio', 'sim_entry_usdc_amount', 'sim_initial_capital',
      'sim_min_bid_to_ask_ratio', 'sim_momentum_filter_enabled', 'sim_signal_score_sizing_enabled',
      'sim_sl_tp_enabled', 'sim_sl_percent', 'sim_tp_percent',
      'sim_trailing_enabled', 'sim_trailing_stop_percent', 'sim_trailing_activation_percent',
      'sim_copy_increase_enabled', 'sim_copy_decrease_enabled', 'sim_max_increases_per_position',
      'sim_copy_increase_sl_proximity_enabled', 'sim_copy_increase_sl_proximity_percent',
      'sim_max_position_size_usdc', 'sim_max_exposure_usdc', 'sim_max_open_positions',
      'sim_allowed_market_tags'
    ];
    for (const k of keys) {
      console.log(`  ${k}: ${rc?.[k]}`);
    }

    // Check sizing distribution for successful vs failed entries
    console.log('\n=== TAILLES DEMANDÉES (réussies vs échouées) ===');
    const sizesRes = await client.query(`
      SELECT
        e.status,
        COUNT(*) as n,
        AVG(e.requested_qty) as avg_qty,
        MIN(e.requested_qty) as min_qty,
        MAX(e.requested_qty) as max_qty,
        AVG(e.fill_price) as avg_price
      FROM executions e
      JOIN copied_positions p ON e.copied_position_id = p.id
      WHERE e.mode='sim' AND e.reason='COPY_OPEN'
      GROUP BY e.status
    `);
    console.log(JSON.stringify(sizesRes.rows, null, 2));
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});