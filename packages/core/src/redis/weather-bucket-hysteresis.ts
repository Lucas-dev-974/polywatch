import type { Redis } from 'ioredis';

export function weatherBucketHysteresisKey(copiedPositionId: number): string {
  return `weather-bucket-hysteresis:${copiedPositionId}`;
}

/**
 * Increment consecutive out-of-bucket polls. Returns the new count.
 * Uses a generous TTL so counters expire if the position is closed/forgotten.
 */
export async function incrementWeatherBucketHysteresis(
  redis: Pick<Redis, 'incr' | 'expire'>,
  copiedPositionId: number,
  ttlSeconds = 86_400,
): Promise<number> {
  const key = weatherBucketHysteresisKey(copiedPositionId);
  const count = await redis.incr(key);
  await redis.expire(key, Math.max(60, ttlSeconds));
  return count;
}

export async function resetWeatherBucketHysteresis(
  redis: Pick<Redis, 'del'>,
  copiedPositionId: number,
): Promise<void> {
  await redis.del(weatherBucketHysteresisKey(copiedPositionId));
}

export async function getWeatherBucketHysteresis(
  redis: Pick<Redis, 'get'>,
  copiedPositionId: number,
): Promise<number> {
  const raw = await redis.get(weatherBucketHysteresisKey(copiedPositionId));
  const n = raw == null ? 0 : Number(raw);
  return Number.isFinite(n) ? n : 0;
}
