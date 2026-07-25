import type { MockRedis } from './redis-mock.js';

/**
 * Drain all jobs currently enqueued in a MockRedis list, invoking `handler`
 * for each one in FIFO order. Returns the number of jobs processed.
 *
 * The MockRedis `lpop` is non-blocking (returns null when empty), so we loop
 * until the list is drained. This replaces the `brpoplpush`-based consumer
 * loop that a real Redis connection would use.
 */
export async function drainQueue<T>(
  redis: MockRedis,
  name: string,
  handler: (job: T) => Promise<void>,
): Promise<number> {
  let count = 0;
  let raw = await redis.lpop(name);
  while (raw !== null) {
    await handler(JSON.parse(raw) as T);
    count++;
    raw = await redis.lpop(name);
  }
  return count;
}