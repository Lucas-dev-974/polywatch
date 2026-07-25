import Redis from 'ioredis';
import { loadMonorepoEnv } from '../packages/core/src/config/env.js';
import { WORKER_QUEUES } from '../packages/core/src/queue/worker-queues.js';

loadMonorepoEnv();

const redisUrl = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
const redis = new Redis(redisUrl);

async function main() {
  const keys = [
    WORKER_QUEUES.ORDER_SIGNALS,
    `${WORKER_QUEUES.ORDER_SIGNALS}:processing`,
    `${WORKER_QUEUES.ORDER_SIGNALS}:dead`,
    WORKER_QUEUES.ALGO_ORDER_SIGNALS,
    `${WORKER_QUEUES.ALGO_ORDER_SIGNALS}:processing`,
    `${WORKER_QUEUES.ALGO_ORDER_SIGNALS}:dead`,
    WORKER_QUEUES.CLOSE_SIGNALS,
    `${WORKER_QUEUES.CLOSE_SIGNALS}:processing`,
    `${WORKER_QUEUES.CLOSE_SIGNALS}:dead`,
    WORKER_QUEUES.EXECUTION_RESULTS,
    `${WORKER_QUEUES.EXECUTION_RESULTS}:processing`,
    WORKER_QUEUES.MOVE_EVENTS,
    `${WORKER_QUEUES.MOVE_EVENTS}:processing`,
  ];
  for (const k of keys) {
    const len = await redis.llen(k);
    console.log(`${k}: ${len}`);
  }
  const sample = await redis.lrange(WORKER_QUEUES.ORDER_SIGNALS, 0, 2);
  const algoSample = await redis.lrange(WORKER_QUEUES.ALGO_ORDER_SIGNALS, 0, 2);
  const processing = await redis.lrange(`${WORKER_QUEUES.ORDER_SIGNALS}:processing`, 0, 2);
  const dead = await redis.lrange(`${WORKER_QUEUES.ORDER_SIGNALS}:dead`, 0, 2);
  console.log('sample order-signals', sample);
  console.log('sample algo-order-signals', algoSample);
  console.log('sample processing', processing);
  console.log('sample dead', dead);
  await redis.quit();
}

main().catch(async (e) => {
  console.error(e);
  await redis.quit();
  process.exit(1);
});
