import pg from 'pg';
import Redis from 'ioredis';
import { loadMonorepoEnv } from '../packages/core/src/config/env.js';

loadMonorepoEnv();

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const redis = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379');
const j = (v: unknown) => JSON.stringify(v, null, 2);

async function main() {
  const c = await pool.connect();
  try {
    console.log('=== PENDING ALGO SIM (current window) ===');
    console.log(
      j(
        (
          await c.query(`
      SELECT p.id, p.status, p.close_reason, p.outcome, p.quantity, p.opened_at,
             m.question, s.crypto_symbol,
             r.order_signal_id, r.reserved_notional_usdc, r.created_at, r.expires_at
      FROM copied_positions p
      LEFT JOIN markets m ON m.condition_id = p.condition_id
      LEFT JOIN algo_market_selections s ON s.condition_id = p.condition_id
      LEFT JOIN position_reservations r ON r.copied_position_id = p.id
      WHERE p.mode = 'sim' AND p.status = 'pending' AND p.reason = 'ALGO_OPEN'
      ORDER BY p.id
    `)
        ).rows,
      ),
    );

    console.log('\n=== CANCELLED ALGO SIM (recent) ===');
    console.log(
      j(
        (
          await c.query(`
      SELECT p.id, p.status, p.close_reason, p.outcome, p.opened_at, m.question
      FROM copied_positions p
      LEFT JOIN markets m ON m.condition_id = p.condition_id
      WHERE p.mode = 'sim' AND p.reason = 'ALGO_OPEN'
        AND p.status IN ('cancelled', 'closed')
      ORDER BY p.id DESC
      LIMIT 20
    `)
        ).rows,
      ),
    );

    console.log('\n=== EXECUTIONS FOR ALGO SIM ===');
    console.log(
      j(
        (
          await c.query(`
      SELECT e.id, e.copied_position_id, e.status, e.error, e.side, e.mode, e.executed_at
      FROM executions e
      JOIN copied_positions p ON p.id = e.copied_position_id
      WHERE p.reason = 'ALGO_OPEN' AND e.mode = 'sim'
      ORDER BY e.id DESC
      LIMIT 30
    `)
        ).rows,
      ),
    );

    console.log('\n=== SIM EXECUTION STATS ===');
    console.log(
      j(
        (
          await c.query(`
      SELECT status, side, COUNT(*)::int AS n
      FROM executions WHERE mode = 'sim'
      GROUP BY status, side
    `)
        ).rows,
      ),
    );

    console.log('\n=== RISK / SIM CONFIG ===');
    console.log(
      j(
        (
          await c.query(`
      SELECT sim_copy_trading_enabled, sim_initial_capital,
             crypto_algo_enabled, real_trading_enabled
      FROM risk_config WHERE id = 1
    `)
        ).rows[0],
      ),
    );

    console.log('\n=== REDIS QUEUES ===');
    for (const k of [
      'algo-order-signals',
      'algo-order-signals:processing',
      'algo-order-signals:dead',
      'order-signals',
      'order-signals:processing',
      'order-signals:dead',
      'execution-results',
      'execution-results:processing',
    ]) {
      console.log(`${k}: ${await redis.llen(k)}`);
    }

    const pendingRows = (
      await c.query(`
      SELECT id FROM copied_positions
      WHERE mode = 'sim' AND status = 'pending' AND reason = 'ALGO_OPEN'
    `)
    ).rows as { id: number }[];
    const pendingIds = new Set(pendingRows.map((r) => r.id));

    const queueSample = await redis.lrange('algo-order-signals', 0, 200);
    const pendingInQueue = queueSample.filter((s) => {
      try {
        const parsed = JSON.parse(s) as { copiedPositionId?: number };
        return pendingIds.has(parsed.copiedPositionId ?? -1);
      } catch {
        return false;
      }
    });
    console.log('\n=== PENDING POSITIONS IN algo-order-signals QUEUE ===');
    console.log(`count=${pendingInQueue.length}`);
    for (const s of pendingInQueue.slice(0, 10)) {
      console.log(s);
    }

    const deadSample = await redis.lrange('algo-order-signals:dead', 0, 20);
    const algoDead = deadSample.filter((s) => s.includes('ALGO_OPEN'));
    console.log('\n=== ALGO_OPEN IN DEAD LETTER (sample) ===');
    console.log(`count=${algoDead.length}`);
    for (const s of algoDead.slice(0, 5)) {
      console.log(s);
    }
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
