import pg from 'pg';
import Redis from 'ioredis';
import { loadMonorepoEnv } from '../packages/core/src/config/env.js';

loadMonorepoEnv();

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const redis = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379');
const j = (v: unknown) => JSON.stringify(v, null, 2);

async function main() {
  const signalId = '205e3ff3bf8f9bbf6bdd7ac9477c2663955ba62735ca7aa640bc6f238e3dd3fe';
  const markerKey = `algo-order-signals:enqueued:${signalId}`;
  console.log('dedup marker', await redis.get(markerKey));
  console.log('dedup ttl', await redis.ttl(markerKey));

  const c = await pool.connect();
  try {
    console.log('\n=== POSITIONS 21680-21683 ===');
    console.log(
      j(
        (
          await c.query(`
      SELECT p.id, p.status, p.close_reason, p.reason, p.outcome, p.watchlist_id,
             p.condition_id, p.asset_id, p.opened_at, p.closed_at
      FROM copied_positions p
      WHERE p.id BETWEEN 21680 AND 21683
      ORDER BY p.id
    `)
        ).rows,
      ),
    );

    console.log('\n=== RESERVATIONS ===');
    console.log(
      j(
        (
          await c.query(`
      SELECT * FROM position_reservations
      WHERE copied_position_id BETWEEN 21680 AND 21683
      ORDER BY id
    `)
        ).rows,
      ),
    );

    console.log('\n=== EXECUTIONS ===');
    console.log(
      j(
        (
          await c.query(`
      SELECT id, copied_position_id, status, error, reason, side, mode,
             order_signal_id, executed_at
      FROM executions
      WHERE copied_position_id BETWEEN 21680 AND 21683
      ORDER BY id
    `)
        ).rows,
      ),
    );

    console.log('\n=== EXECUTION-RESULTS QUEUES ===');
    for (const k of ['execution-results', 'execution-results:processing', 'execution-results:dead']) {
      const len = await redis.llen(k);
      console.log(`${k}: ${len}`);
      if (len > 0) {
        const sample = await redis.lrange(k, 0, 3);
        for (const s of sample) {
          if (s.includes('21682') || s.includes('21681') || s.includes(signalId.slice(0, 16))) {
            console.log('MATCH:', s);
          }
        }
      }
    }

    const dead = await redis.lrange('algo-order-signals:dead', 0, -1);
    const deadMatch = dead.filter(
      (s) => s.includes('21682') || s.includes('21681') || s.includes(signalId),
    );
    console.log('\n=== ALGO DEAD LETTER MATCHES ===', deadMatch.length);
    for (const s of deadMatch) console.log(s);

    const proc = await redis.lrange('algo-order-signals:processing', 0, -1);
    console.log('\n=== ALGO PROCESSING ===', proc.length);
    for (const s of proc) console.log(s.slice(0, 300));

    console.log('\n=== RECENT reservation_released (no exec) ===');
    console.log(
      j(
        (
          await c.query(`
      SELECT p.id, p.status, p.close_reason, p.outcome, p.opened_at,
             r.order_signal_id, r.created_at AS resv_at, r.expires_at,
             (SELECT COUNT(*)::int FROM executions e WHERE e.copied_position_id = p.id) AS exec_count
      FROM copied_positions p
      LEFT JOIN position_reservations r ON r.copied_position_id = p.id
      WHERE p.reason = 'ALGO_OPEN' AND p.mode = 'sim'
        AND p.close_reason = 'reservation_released'
        AND p.id >= 21670
      ORDER BY p.id DESC
      LIMIT 10
    `)
        ).rows,
      ),
    );
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
