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
    console.log('=== LAST 15 SIM EXECUTIONS ===');
    console.log(
      j(
        (
          await c.query(`
      SELECT e.id, e.copied_position_id, e.status, e.error, e.reason, e.executed_at,
             p.status AS pos_status
      FROM executions e
      LEFT JOIN copied_positions p ON p.id = e.copied_position_id
      WHERE e.mode = 'sim'
      ORDER BY e.id DESC LIMIT 15
    `)
        ).rows,
      ),
    );

    console.log('\n=== EXEC COUNT LAST 10 MIN ===');
    console.log(
      j(
        (
          await c.query(`
      SELECT COUNT(*)::int AS n,
             MAX(executed_at) AS last_executed
      FROM executions
      WHERE mode = 'sim' AND executed_at > NOW() - INTERVAL '10 minutes'
    `)
        ).rows[0],
      ),
    );

    console.log('\n=== FAILED reservation_expired COUNT ===');
    console.log(
      j(
        (
          await c.query(`
      SELECT COUNT(*)::int AS n FROM executions
      WHERE mode = 'sim' AND error = 'reservation_expired'
    `)
        ).rows[0],
      ),
    );

    console.log('\n=== QUEUE DEPTHS + SIGNAL AGE ===');
    const qLen = await redis.llen('algo-order-signals');
    console.log(`algo-order-signals: ${qLen}`);
    console.log(`processing: ${await redis.llen('algo-order-signals:processing')}`);
    console.log(`execution-results: ${await redis.llen('execution-results')}`);

    const all = await redis.lrange('algo-order-signals', 0, -1);
    const uniqueIds = new Set<string>();
    const posIds = new Set<number>();
    for (const raw of all) {
      try {
        const parsed = JSON.parse(raw) as { id?: string; copiedPositionId?: number };
        if (parsed.id) uniqueIds.add(parsed.id);
        if (parsed.copiedPositionId) posIds.add(parsed.copiedPositionId);
      } catch {
        /* skip */
      }
    }
    console.log(`total entries: ${all.length}`);
    console.log(`unique signal ids: ${uniqueIds.size}`);
    console.log(`unique positions: ${posIds.size}`);

    const posIdArray = [...posIds];
    if (posIdArray.length > 0) {
      const oldest = await c.query(
        `SELECT MIN(r.created_at) AS oldest_resv, MAX(r.created_at) AS newest_resv,
                COUNT(*) FILTER (WHERE r.expires_at < NOW())::int AS expired_count,
                COUNT(*)::int AS total
         FROM position_reservations r WHERE r.copied_position_id = ANY($1)`,
        [posIdArray],
      );
      console.log('reservations for queued positions:', j(oldest.rows[0]));
    }

    const processing = await redis.lrange('algo-order-signals:processing', 0, -1);
    console.log('\n=== PROCESSING ENTRY (stuck?) ===');
    for (const raw of processing) console.log(raw.slice(0, 250));
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
