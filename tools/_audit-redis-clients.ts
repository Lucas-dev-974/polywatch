import Redis from 'ioredis';
import { loadMonorepoEnv } from '../packages/core/src/config/env.js';

loadMonorepoEnv();

const redis = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379');

async function main() {
  const list = (await redis.client('LIST')) as string;
  const lines = list.split('\n').filter(Boolean);
  console.log(`clients: ${lines.length}`);
  for (const l of lines) {
    const cmd = /cmd=(\S+)/.exec(l)?.[1];
    const name = /name=(\S*)/.exec(l)?.[1];
    const idle = /idle=(\S+)/.exec(l)?.[1];
    console.log(`  cmd=${cmd} name=${name || '-'} idle=${idle}s`);
  }
  await redis.quit();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
