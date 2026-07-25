import pg from 'pg';
import Redis from 'ioredis';
import { loadMonorepoEnv } from '../packages/core/src/config/env.js';

loadMonorepoEnv();

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const redis = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379');

async function main() {
  const c = await pool.connect();
  try {
    const r = await c.query(`
      SELECT id, copied_position_id, status, error, reason, executed_at
      FROM executions
      WHERE mode = 'sim'
      ORDER BY id DESC LIMIT 8
    `);
    console.log('=== LAST EXECUTIONS (created_at) ===');
    console.log(JSON.stringify(r.rows, null, 1));
    console.log('NOW =', new Date().toISOString());

    const len1 = await redis.llen('algo-order-signals');
    await new Promise((res) => setTimeout(res, 8000));
    const len2 = await redis.llen('algo-order-signals');
    console.log(`queue len t0=${len1} t+8s=${len2} (delta ${len2 - len1})`);

    const clients = (await redis.client('LIST')) as string;
    const brpop = clients
      .split('\n')
      .filter((l) => l.includes('brpoplpush') || l.includes('blpop') || l.includes('brpop'));
    console.log('=== BLOCKED REDIS CONSUMERS ===');
    console.log(brpop.length ? brpop.join('\n') : '(none — no consumer waiting)');
  } finally {
    c.release();
    await pool.end();
    await redis.quit();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
