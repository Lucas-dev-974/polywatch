/**
 * Vide les files Redis worker (order-signals, execution-results, …).
 *
 * Usage:
 *   npx tsx tools/flush-redis-queues.ts              # aperçu (dry-run)
 *   npx tsx tools/flush-redis-queues.ts --confirm      # purge réelle
 *   npx tsx tools/flush-redis-queues.ts --confirm --release-reservations
 *
 * Recommandé : arrêter le worker avant --confirm, puis le relancer après.
 *
 * Note : `POST /api/simulation-balance/reset` purge automatiquement les jobs et marqueurs
 * Redis `mode:sim` (voir docs/snapshots-simulation.md). Ce script reste utile pour les
 * incidents worker-down (file saturée, 0 consommateur BRPOPLPUSH) sans reset sim.
 */
import pg from 'pg';
import Redis from 'ioredis';
import { loadMonorepoEnv } from '../packages/core/src/config/env.js';
import { WORKER_QUEUES, deadLetterQueueKey } from '../packages/core/src/queue/worker-queues.js';

loadMonorepoEnv();

const confirm = process.argv.includes('--confirm');
const releaseReservations = process.argv.includes('--release-reservations');

const QUEUES_TO_FLUSH = [
  WORKER_QUEUES.ORDER_SIGNALS,
  WORKER_QUEUES.ALGO_ORDER_SIGNALS,
  WORKER_QUEUES.EXECUTION_RESULTS,
] as const;

function processingKey(name: string): string {
  return `${name}:processing`;
}

async function main() {
  const redisUrl = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
  const redis = new Redis(redisUrl);

  console.log(confirm ? '\n=== PURGE (confirm) ===\n' : '\n=== APERÇU (dry-run) ===\n');

  const keys = [
    ...QUEUES_TO_FLUSH,
    ...QUEUES_TO_FLUSH.map(processingKey),
    ...QUEUES_TO_FLUSH.map(deadLetterQueueKey),
  ];

  for (const key of keys) {
    const len = await redis.llen(key);
    console.log(`${key}: ${len}`);
  }

  if (!confirm) {
    console.log('\nAucune modification. Relancez avec --confirm pour purger.');
    console.log('Ajoutez --release-reservations pour annuler les pending liés aux signaux supprimés.');
    await redis.quit();
    return;
  }

  let released = 0;
  if (releaseReservations) {
    const rawSignals = [
      ...(await redis.lrange(WORKER_QUEUES.ORDER_SIGNALS, 0, -1)),
      ...(await redis.lrange(WORKER_QUEUES.ALGO_ORDER_SIGNALS, 0, -1)),
    ];
    const signalIds = rawSignals
      .map((raw) => {
        try {
          return (JSON.parse(raw) as { id?: string }).id ?? null;
        } catch {
          return null;
        }
      })
      .filter((id): id is string => !!id);

    if (signalIds.length > 0) {
      const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
      const client = await pool.connect();
      try {
        for (const orderSignalId of signalIds) {
          const res = await client.query(
            `DELETE FROM position_reservations WHERE order_signal_id = $1 RETURNING copied_position_id`,
            [orderSignalId],
          );
          if (res.rowCount) {
            for (const row of res.rows) {
              await client.query(
                `UPDATE copied_positions SET status = 'cancelled', close_reason = 'reservation_released'
                 WHERE id = $1 AND status = 'pending'`,
                [row.copied_position_id],
              );
            }
            released += res.rowCount;
          }
        }
      } finally {
        client.release();
        await pool.end();
      }
      console.log(`\nRéservations libérées / positions pending annulées: ${released}`);
    }
  }

  for (const key of [
    ...QUEUES_TO_FLUSH,
    ...QUEUES_TO_FLUSH.map(processingKey),
  ]) {
    await redis.del(key);
    console.log(`supprimé: ${key}`);
  }

  console.log('\nPurge terminée. Relancez le worker, puis vérifiez avec:');
  console.log('  npx tsx tools/_audit-redis-queues.ts');
  await redis.quit();
}

main().catch(async (err) => {
  console.error(err);
  process.exit(1);
});
