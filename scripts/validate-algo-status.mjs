import pg from 'pg';
import Redis from 'ioredis';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? 'postgresql://polywatch:polywatch@localhost:5432/polywatch',
});
const redis = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379');

try {
  const sel = await pool.query(`
    SELECT s.condition_id, s.enabled, s.crypto_symbol, s.interval,
           (m.token_id_yes IS NOT NULL) AS has_market,
           m.resolved, m.closed, m.end_date
    FROM algo_market_selections s
    LEFT JOIN markets m ON m.condition_id = s.condition_id
    WHERE s.enabled = true
    ORDER BY s.updated_at DESC`);

  const risk = await pool.query(
    'SELECT crypto_algo_enabled, real_trading_enabled FROM risk_config LIMIT 1',
  );
  const hb = await redis.get('crypto-algo:heartbeat');
  const rt = await redis.get('crypto-algo:runtime-status');

  console.log('=== Enabled selections ===');
  console.table(sel.rows);
  console.log('=== Risk config ===', risk.rows[0] ?? null);
  console.log(
    '=== Redis heartbeat ===',
    hb,
    hb && Number.isFinite(Number(hb)) ? new Date(Number(hb)).toISOString() : null,
  );
  console.log('=== Redis runtime ===', rt ? JSON.parse(rt) : null);
} catch (err) {
  console.error('Validation failed:', err.message);
  process.exitCode = 1;
} finally {
  await pool.end();
  redis.disconnect();
}
