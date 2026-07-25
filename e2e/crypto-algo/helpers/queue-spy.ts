import type { OrderSignal } from '@polywatch/core';
import type { MockRedis } from './redis-mock.js';

/**
 * Spy on a Redis-backed order queue by reading the underlying Redis list.
 */
export class QueueSpy {
  constructor(
    private readonly redis: MockRedis,
    private readonly name: string,
  ) {}

  all(): OrderSignal[] {
    return this.redis.getQueue(this.name).map((raw) => JSON.parse(raw) as OrderSignal);
  }

  buys(): OrderSignal[] {
    return this.all().filter((s) => s.side === 'BUY');
  }

  sells(): OrderSignal[] {
    return this.all().filter((s) => s.side === 'SELL');
  }

  clear(): void {
    this.redis.clear();
  }
}
