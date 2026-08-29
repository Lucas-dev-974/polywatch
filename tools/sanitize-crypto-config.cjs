/**
 * Hygiene-only crypto_config cleanup.
 *
 * Do NOT use PUT /api/config/crypto — these fields are in cryptoRotationKeys and
 * would trigger a sim hard-rotate (archive + purge open sim positions).
 * Updates SQL directly, then publishes config-changed.
 *
 * Never touches: crypto_algo_enabled, entry price band, sim capital, TP, sizing.
 *
 * Usage: node tools/sanitize-crypto-config.cjs [--dry-run]
 */
const { Client } = require('pg');
const Redis = require('ioredis');

const DATABASE_URL =
  process.env.DATABASE_URL ||
  'postgresql://polywatch:polywatch@localhost:5432/polywatch';
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const pg = new Client({ connectionString: DATABASE_URL });
  await pg.connect();

  const beforeRes = await pg.query(`
    SELECT
      id,
      crypto_algo_enabled,
      crypto_algo_min_spread_abs_for_adjustment,
      crypto_algo_max_daily_loss_pusd,
      crypto_algo_trailing_bid_points,
      crypto_algo_trailing_activation_bid_points,
      sim_initial_capital_crypto,
      crypto_algo_tp_enabled,
      crypto_algo_entry_share_count
    FROM crypto_config
    WHERE id = 1
  `);
  if (beforeRes.rows.length === 0) {
    throw new Error('crypto_config id=1 not found');
  }
  const before = beforeRes.rows[0];
  console.log('before:', JSON.stringify(before, null, 2));

  const capital = Number(before.sim_initial_capital_crypto);
  const currentDailyLoss = Number(before.crypto_algo_max_daily_loss_pusd);
  const updates = {
    crypto_algo_min_spread_abs_for_adjustment: 0.01,
    crypto_algo_trailing_bid_points: 0.05,
    crypto_algo_trailing_activation_bid_points: 0.06,
  };

  // Only clamp daily loss when it exceeds sim capital (inert / dangerous limit).
  if (
    Number.isFinite(capital) &&
    capital > 0 &&
    Number.isFinite(currentDailyLoss) &&
    currentDailyLoss > capital
  ) {
    updates.crypto_algo_max_daily_loss_pusd = capital;
  }

  console.log('planned updates:', JSON.stringify(updates, null, 2));
  console.log(
    'untouched: crypto_algo_enabled, entry band, sim_initial_capital_crypto, tp, entry_share_count',
  );

  if (dryRun) {
    console.log('dry-run — no write');
    await pg.end();
    return;
  }

  const keys = Object.keys(updates);
  const sets = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
  await pg.query(`UPDATE crypto_config SET ${sets} WHERE id = 1`, Object.values(updates));

  const afterRes = await pg.query(`
    SELECT
      crypto_algo_enabled,
      crypto_algo_min_spread_abs_for_adjustment,
      crypto_algo_max_daily_loss_pusd,
      crypto_algo_trailing_bid_points,
      crypto_algo_trailing_activation_bid_points,
      sim_initial_capital_crypto
    FROM crypto_config
    WHERE id = 1
  `);
  const after = afterRes.rows[0];
  console.log('after:', JSON.stringify(after, null, 2));

  if (Boolean(after.crypto_algo_enabled) !== Boolean(before.crypto_algo_enabled)) {
    throw new Error('safety check failed: crypto_algo_enabled changed unexpectedly');
  }

  const redis = new Redis(REDIS_URL);
  const receivers = await redis.publish(
    'config-changed',
    JSON.stringify({
      kind: 'crypto',
      source: 'sanitize-crypto-config',
      at: new Date().toISOString(),
    }),
  );
  console.log('config-changed published, receivers:', receivers);
  redis.disconnect();
  await pg.end();
  console.log('crypto config hygiene applied (no sim hard-rotate)');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
