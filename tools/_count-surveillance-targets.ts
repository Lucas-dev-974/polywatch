import pg from 'pg';
import { loadMonorepoEnv } from '../packages/core/src/config/env.js';

loadMonorepoEnv();
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const c = await pool.connect();
  try {
    const enabled = await c.query(
      `SELECT COUNT(*)::int AS n FROM algo_market_selections WHERE enabled = true`,
    );
    const all = await c.query(`SELECT COUNT(*)::int AS n FROM algo_market_selections`);
    const rules = await c.query(
      `SELECT COUNT(*)::int AS n FROM algo_auto_track_rules WHERE enabled = true`,
    );
    const sample = await c.query(
      `SELECT crypto_symbol, interval, LEFT(condition_id, 18) AS cid
       FROM algo_market_selections WHERE enabled = true ORDER BY crypto_symbol, interval`,
    );
    console.log(
      JSON.stringify(
        {
          enabled_selections: enabled.rows[0].n,
          total_selections: all.rows[0].n,
          enabled_auto_track_rules: rules.rows[0].n,
          markets: sample.rows,
          note: 'Each refresh does Promise.all(N markets) × up to 2 Gamma GETs (+ optional tags/fees)',
        },
        null,
        2,
      ),
    );
  } finally {
    c.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
