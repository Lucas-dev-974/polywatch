import pg from 'pg';
import { loadMonorepoEnv } from '../packages/core/src/config/env.js';

loadMonorepoEnv();

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const c = await pool.connect();
  try {
    console.log(
      JSON.stringify(
        (
          await c.query(
            `SELECT id, max_slippage_percent, sim_exec_latency_ms, sim_exec_latency_mode, sim_self_impact_enabled FROM risk_config ORDER BY id`,
          )
        ).rows,
        null,
        2,
      ),
    );
  } finally {
    c.release();
    await pool.end();
  }
}
main();
