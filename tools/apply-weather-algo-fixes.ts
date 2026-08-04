/**
 * Applique les correctifs P1/P2 de l'audit weather-algo directement en BDD.
 * Usage: npx tsx tools/apply-weather-algo-fixes.ts [--dry-run]
 */
import pg from 'pg';
import { loadMonorepoEnv } from '../packages/core/src/config/env.js';

loadMonorepoEnv();

const updates: Array<{ column: string; value: string | number | boolean; reason: string }> = [
  { column: 'weather_algo_poll_ms', value: 1800000, reason: 'P1-a : 30 min au lieu de 10 s (×180 charge)' },
  { column: 'weather_algo_max_forecast_std', value: 1.5, reason: 'P1-b : filtre incertitude σ > 1.5 °C' },
  { column: 'weather_algo_min_forecast_probability', value: 0.30, reason: 'P0-a : filtre long-shots (forecastProb < 0.30)' },
  { column: 'weather_algo_pre_close_enabled', value: true, reason: 'P1-c : pre-close 1 h avant résolution' },
  { column: 'weather_algo_city_follow_switch_mode', value: 'close_and_reenter', reason: 'P2-a : active le bucket-exit (was hold)' },
  { column: 'weather_algo_sl_enabled', value: true, reason: 'P2-b : stop-loss actif' },
  { column: 'weather_algo_sl_bid_points', value: 0.2, reason: 'P2-b : SL à 0.2 bid points' },
  { column: 'weather_algo_tp_enabled', value: true, reason: 'P2-b : take-profit actif' },
  { column: 'weather_algo_tp_bid_points', value: 1, reason: 'P2-b : TP à 1 bid point' },
];

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const c = await pool.connect();

  try {
    const before = await c.query(
      `SELECT weather_algo_poll_ms, weather_algo_max_forecast_std, weather_algo_min_forecast_probability,
              weather_algo_pre_close_enabled, weather_algo_city_follow_switch_mode,
              weather_algo_sl_enabled, weather_algo_sl_bid_points,
              weather_algo_tp_enabled, weather_algo_tp_bid_points
       FROM weather_config LIMIT 1`,
    );
    console.log('\n=== AVANT ===');
    console.table(before.rows[0]);

    console.log(`\nMode: ${dryRun ? 'DRY-RUN (no changes)' : 'APPLY'}`);
    console.log('\n=== Updates prévues ===');
    for (const u of updates) {
      console.log(`  ${u.column} → ${u.value}  (${u.reason})`);
    }

    if (dryRun) {
      console.log('\nDry-run : aucune modification appliquée.');
      return;
    }

    for (const u of updates) {
      const result = await c.query(
        `UPDATE weather_config SET "${u.column}" = $1`,
        [u.value],
      );
      console.log(`  ✓ ${u.column} = ${u.value} (${result.rowCount} row)`);
    }

    const after = await c.query(
      `SELECT weather_algo_poll_ms, weather_algo_max_forecast_std, weather_algo_min_forecast_probability,
              weather_algo_pre_close_enabled, weather_algo_city_follow_switch_mode,
              weather_algo_sl_enabled, weather_algo_sl_bid_points,
              weather_algo_tp_enabled, weather_algo_tp_bid_points
       FROM weather_config LIMIT 1`,
    );
    console.log('\n=== APRÈS ===');
    console.table(after.rows[0]);
  } finally {
    c.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});