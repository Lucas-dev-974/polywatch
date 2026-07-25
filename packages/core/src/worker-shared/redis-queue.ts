import type { Redis } from 'ioredis';
import { deadLetterQueueKey } from '../queue/worker-queues.js';
import pino from 'pino';

const log = pino({ name: 'redis-queue' });
const MAX_RETRIES = 3;

/**
 * Callback invoked when a job is moved to the dead-letter queue after
 * exceeding the maximum retry count. The worker wires this to its
 * `notifyBackendAlert` function; other packages can provide their own.
 */
export type DeadLetterNotifier = (
  level: 'warning',
  message: string,
) => void;

export interface RedisQueueOptions {
  /**
   * Optional callback fired when a job is moved to the dead-letter queue.
   */
  onDeadLetter?: DeadLetterNotifier;
}

export class RedisQueue<T> {
  private readonly onDeadLetter?: DeadLetterNotifier;

  constructor(
    private readonly redis: Redis,
    private readonly name: string,
    private readonly handler: (job: T) => Promise<void>,
    options?: RedisQueueOptions,
  ) {
    this.onDeadLetter = options?.onDeadLetter;
  }

  private processingKey(): string {
    return `${this.name}:processing`;
  }

  private deadKey(): string {
    return deadLetterQueueKey(this.name);
  }

  async enqueue(job: T): Promise<void> {
    await this.redis.rpush(this.name, JSON.stringify(job));
  }

  /**
   * Enqueue unless a job with the same unique key was already enqueued within
   * the last `ttlSeconds`. Prevents producers that re-emit the same logical
   * signal on every tick (e.g. algo entry resume) from flooding the queue.
   * Returns true when the job was enqueued, false when deduplicated.
   */
  private enqueuedMarkerKey(uniqueKey: string): string {
    return `${this.name}:enqueued:${uniqueKey}`;
  }

  private retryCooldownKey(uniqueKey: string): string {
    return `${this.name}:retry-cooldown:${uniqueKey}`;
  }

  private retryCountKey(uniqueKey: string): string {
    return `${this.name}:retry-count:${uniqueKey}`;
  }

  /** True when the primary dedupe marker from {@link enqueueUnique} is still active. */
  async hasDedupeMarker(uniqueKey: string): Promise<boolean> {
    return (await this.redis.exists(this.enqueuedMarkerKey(uniqueKey))) === 1;
  }

  async enqueueUnique(job: T, uniqueKey: string, ttlSeconds: number): Promise<boolean> {
    const marker = this.enqueuedMarkerKey(uniqueKey);
    const set = await this.redis.set(marker, '1', 'EX', Math.max(1, ttlSeconds), 'NX');
    if (set !== 'OK') return false;
    await this.redis.rpush(this.name, JSON.stringify(job));
    return true;
  }

  /**
   * Acquire a bounded force re-enqueue slot when the primary dedupe marker is
   * still set but the worker may have consumed the prior job without success.
   */
  async acquireBoundedRetrySlot(
    uniqueKey: string,
    reservationTtlSeconds: number,
    options?: { cooldownSeconds?: number; maxRetries?: number },
  ): Promise<boolean> {
    const cooldownSeconds = options?.cooldownSeconds ?? 45;
    const maxRetries = options?.maxRetries ?? 2;
    const countKey = this.retryCountKey(uniqueKey);
    const current = Number((await this.redis.get(countKey)) ?? 0);
    if (current >= maxRetries) return false;

    const cooldownSet = await this.redis.set(
      this.retryCooldownKey(uniqueKey),
      '1',
      'EX',
      Math.max(1, cooldownSeconds),
      'NX',
    );
    if (cooldownSet !== 'OK') return false;

    const next = await this.redis.incr(countKey);
    if (next === 1) {
      await this.redis.expire(countKey, Math.max(1, reservationTtlSeconds));
    }
    return true;
  }

  async recoverOrphans(): Promise<void> {
    const processing = this.processingKey();
    let item: string | null;
    while ((item = await this.redis.rpoplpush(processing, this.name))) {
      log.info({ queue: this.name }, 'reinjected orphan job');
    }
  }

  async startConsumer(): Promise<void> {
    const processing = this.processingKey();
    const dead = this.deadKey();

    while (true) {
      const raw = await this.redis.brpoplpush(
        this.name,
        processing,
        5,
      );
      if (!raw) continue;

      let job: T;
      try {
        job = JSON.parse(raw) as T;
      } catch {
        await this.redis.lrem(processing, 1, raw);
        continue;
      }

      try {
        await this.handler(job);
        await this.redis.lrem(processing, 1, raw);
      } catch (err) {
        log.error({ err, queue: this.name }, 'job failed');
        const retryKey = `${raw}::retries`;
        const retries = Number((await this.redis.get(retryKey)) ?? 0) + 1;
        await this.redis.set(retryKey, String(retries), 'EX', 3600);
        await this.redis.lrem(processing, 1, raw);

        if (retries >= MAX_RETRIES) {
          await this.redis.rpush(dead, raw);
          await this.redis.del(retryKey);
          log.error({ queue: this.name }, 'job moved to dead letter');
          this.onDeadLetter?.(
            'warning',
            `Queue "${this.name}" — job moved to dead letter after ${MAX_RETRIES} retries`,
          );
        } else {
          await this.redis.rpush(this.name, raw);
        }
      }
    }
  }

  async replayDead(limit = 10): Promise<number> {
    const dead = this.deadKey();
    let replayed = 0;
    for (let i = 0; i < limit; i++) {
      const raw = await this.redis.lpop(dead);
      if (!raw) break;
      await this.redis.rpush(this.name, raw);
      replayed++;
    }
    return replayed;
  }
}