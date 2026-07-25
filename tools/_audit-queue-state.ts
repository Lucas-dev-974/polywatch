import Redis from 'ioredis';
import { loadMonorepoEnv } from '../packages/core/src/config/env.js';

loadMonorepoEnv();

const redis = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379');

async function main() {
  for (const q of ['algo-order-signals', 'order-signals', 'execution-results']) {
    const len = await redis.llen(q);
    const processing = await redis.llen(`${q}:processing`);
    const dead = await redis.llen(`${q}:dead`);
    console.log(`${q}: waiting=${len} processing=${processing} dead=${dead}`);
    if (len > 0) {
      const items = await redis.lrange(q, 0, 4);
      for (const it of items) {
        try {
          const j = JSON.parse(it);
          console.log('  ->', j.id?.slice(0, 16), 'pos', j.copiedPositionId, j.reason, j.side);
        } catch {
          console.log('  -> (unparseable)');
        }
      }
    }
  }
  await redis.quit();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
