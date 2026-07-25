import pg from 'pg';
import { loadMonorepoEnv } from '../packages/core/src/config/env.js';

loadMonorepoEnv();

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const c = await pool.connect();
  try {
    const rules = await c.query(`
      SELECT id, crypto_symbol, interval, enabled, created_at
      FROM algo_auto_track_rules ORDER BY id
    `);
    console.log('AUTO_TRACK_RULES', JSON.stringify(rules.rows, null, 1));

    const enabledRules = rules.rows.filter((r) => r.enabled);
    console.log(`enabled rules: ${enabledRules.length}/${rules.rows.length}`);

    const selections = await c.query(`
      SELECT id, condition_id, crypto_symbol, interval, enabled, question, created_at
      FROM algo_market_selections ORDER BY id DESC LIMIT 15
    `);
    console.log('SELECTIONS (last 15)', JSON.stringify(selections.rows, null, 1));

    const enabledSel = await c.query(`
      SELECT COUNT(*)::int AS n FROM algo_market_selections WHERE enabled = true
    `);
    console.log('ENABLED SELECTIONS', enabledSel.rows[0]);

    const risk = await c.query(`
      SELECT crypto_algo_enabled FROM risk_config WHERE id = 1
    `);
    console.log('RISK', risk.rows[0]);
  } finally {
    c.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
