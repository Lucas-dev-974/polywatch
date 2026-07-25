import pg from 'pg';
import { loadMonorepoEnv } from '../packages/core/src/config/env.js';

loadMonorepoEnv();

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const c = await pool.connect();
  try {
    const r = await c.query(`
      SELECT sim_sizing_mode, sim_entry_usdc_amount, sim_entry_share_count,
             sim_max_position_size_usdc, sim_signal_score_sizing_enabled
      FROM risk_config WHERE id = 1
    `);
    console.log('SIZING CONFIG', JSON.stringify(r.rows[0], null, 2));

    const m = await c.query(`
      SELECT name FROM migrations ORDER BY id DESC LIMIT 5
    `);
    console.log('LAST MIGRATIONS', JSON.stringify(m.rows, null, 2));
  } finally {
    c.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
