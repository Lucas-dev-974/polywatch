import { describe, expect, it } from 'vitest';
import {
  deadLetterQueueKey,
  isKnownWorkerQueue,
  replayDeadLetterQueue,
  WORKER_QUEUES,
} from './worker-queues.js';

describe('worker-queues', () => {
  it('identifies known queue names', () => {
    expect(isKnownWorkerQueue(WORKER_QUEUES.CLOSE_SIGNALS)).toBe(true);
    expect(isKnownWorkerQueue(WORKER_QUEUES.ALGO_ORDER_SIGNALS)).toBe(true);
    expect(isKnownWorkerQueue(WORKER_QUEUES.WEATHER_ORDER_SIGNALS)).toBe(true);
    expect(isKnownWorkerQueue('unknown-queue')).toBe(false);
  });

  it('builds dead-letter key', () => {
    expect(deadLetterQueueKey('order-signals')).toBe('order-signals:dead');
  });

  it('replays dead-letter jobs up to limit', async () => {
    const dead: string[] = ['job1', 'job2', 'job3'];
    const main: string[] = [];
    const redis = {
      async lpop(key: string) {
        if (key !== 'order-signals:dead') return null;
        return dead.shift() ?? null;
      },
      async rpush(key: string, value: string) {
        if (key === 'order-signals') main.push(value);
        return main.length;
      },
    };

    const replayed = await replayDeadLetterQueue(redis, WORKER_QUEUES.ORDER_SIGNALS, 2);
    expect(replayed).toBe(2);
    expect(main).toEqual(['job1', 'job2']);
    expect(dead).toEqual(['job3']);
  });
});
