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
    console.log('=== PLACING SIM EXECUTIONS ===');
    console.log(
      j(
        (
          await c.query(`
      SELECT e.id, e.copied_position_id, e.status, e.error, e.order_signal_id,
             p.status AS pos_status, p.close_reason, p.outcome, s.question
      FROM executions e
      JOIN copied_positions p ON p.id = e.copied_position_id
      LEFT JOIN algo_market_selections s ON s.condition_id = p.condition_id
      WHERE e.mode = 'sim' AND e.status = 'placing'
      ORDER BY e.id
    `)
        ).rows,
      ),
    );

    console.log('\n=== PENDING ALGO SIM ===');
    console.log(
      j(
        (
          await c.query(`
      SELECT p.id, p.status, p.close_reason, p.outcome,
             r.order_signal_id, r.created_at, r.expires_at,
             (SELECT COUNT(*)::int FROM executions e WHERE e.copied_position_id = p.id) AS exec_count
      FROM copied_positions p
      LEFT JOIN position_reservations r ON r.copied_position_id = p.id
      WHERE p.mode = 'sim' AND p.status = 'pending' AND p.reason = 'ALGO_OPEN'
      ORDER BY p.id
    `)
        ).rows,
      ),
    );

    console.log('\n=== RISK CONFIG ===');
    console.log(
      j(
        (
          await c.query(`
      SELECT sim_copy_trading_enabled, sim_initial_capital
      FROM risk_config WHERE id = 1
    `)
        ).rows[0],
      ),
    );

    const keys = ['order-signals', 'order-signals:processing', 'order-signals:dead'];
    console.log('\n=== REDIS QUEUES ===');
    for (const k of keys) {
      console.log(`${k}: ${await redis.llen(k)}`);
    }

    const all = await redis.lrange('order-signals', 0, 400);
    const byReason: Record<string, number> = {};
    const byMode: Record<string, number> = {};
    for (const raw of all) {
      const parsed = JSON.parse(raw) as { reason?: string; mode?: string };
      const reason = parsed.reason ?? 'unknown';
      const mode = parsed.mode ?? 'unknown';
      byReason[reason] = (byReason[reason] ?? 0) + 1;
      byMode[mode] = (byMode[mode] ?? 0) + 1;
    }
    console.log('\n=== QUEUE COMPOSITION (head 401) ===');
    console.log('byReason', j(byReason));
    console.log('byMode', j(byMode));
    console.log('oldest', all[0]?.slice(0, 200));
    console.log('newest', all[all.length - 1]?.slice(0, 200));

    const pendingRows = (
      await c.query(`
      SELECT id FROM copied_positions
      WHERE mode = 'sim' AND status = 'pending' AND reason = 'ALGO_OPEN'
    `)
    ).rows as { id: number }[];
    const pendingIds = new Set(pendingRows.map((r) => r.id));
    const pendingSignals = all.filter((raw) => {
      const parsed = JSON.parse(raw) as { copiedPositionId?: number };
      return pendingIds.has(parsed.copiedPositionId ?? -1);
    });
    console.log('\n=== PENDING POSITION SIGNALS STILL IN QUEUE ===');
    console.log(`count=${pendingSignals.length}`);
    for (const s of pendingSignals) console.log(s);

    console.log('\n=== RECENT ALGO SIM TIMELINE ===');
    console.log(
      j(
        (
          await c.query(`
      SELECT p.id AS pos_id, p.status AS pos_status, p.close_reason,
             e.id AS exec_id, e.status AS exec_status, e.error,
             r.created_at AS reserved_at, r.expires_at,
             e.executed_at
      FROM copied_positions p
      LEFT JOIN executions e ON e.copied_position_id = p.id
      LEFT JOIN position_reservations r ON r.copied_position_id = p.id
      WHERE p.watchlist_id = 40 AND p.reason = 'ALGO_OPEN' AND p.mode = 'sim'
        AND p.id >= 20860
      ORDER BY p.id, e.id
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
