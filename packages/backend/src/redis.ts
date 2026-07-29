import { createRedis } from '@polywatch/core';

let redis: ReturnType<typeof createRedis> | null = null;

export function getRedis(): ReturnType<typeof createRedis> {
  if (!redis) {
    redis = createRedis();
  }
  return redis;
}

export async function publishConfigChanged(
  kind?: 'global' | 'copy' | 'crypto' | 'weather',
): Promise<void> {
  await getRedis().publish(
    'config-changed',
    JSON.stringify({ at: Date.now(), kind }),
  );
}
