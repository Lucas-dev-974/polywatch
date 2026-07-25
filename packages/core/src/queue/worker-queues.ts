export const WORKER_QUEUES = {
  MOVE_EVENTS: 'move-events',
  ORDER_SIGNALS: 'order-signals',
  ALGO_ORDER_SIGNALS: 'algo-order-signals',
  WEATHER_ORDER_SIGNALS: 'weather-order-signals',
  CLOSE_SIGNALS: 'close-signals',
  EXECUTION_RESULTS: 'execution-results',
} as const;

export type WorkerQueueName =
  (typeof WORKER_QUEUES)[keyof typeof WORKER_QUEUES];

export const KNOWN_WORKER_QUEUE_NAMES: readonly WorkerQueueName[] = [
  WORKER_QUEUES.MOVE_EVENTS,
  WORKER_QUEUES.ORDER_SIGNALS,
  WORKER_QUEUES.ALGO_ORDER_SIGNALS,
  WORKER_QUEUES.WEATHER_ORDER_SIGNALS,
  WORKER_QUEUES.CLOSE_SIGNALS,
  WORKER_QUEUES.EXECUTION_RESULTS,
];

export function isKnownWorkerQueue(name: string): name is WorkerQueueName {
  return (KNOWN_WORKER_QUEUE_NAMES as readonly string[]).includes(name);
}

export function deadLetterQueueKey(queueName: string): string {
  return `${queueName}:dead`;
}

export interface RedisListClient {
  lpop(key: string): Promise<string | null>;
  rpush(key: string, value: string): Promise<number>;
}

export async function replayDeadLetterQueue(
  redis: RedisListClient,
  queueName: WorkerQueueName,
  limit: number,
): Promise<number> {
  const dead = deadLetterQueueKey(queueName);
  let replayed = 0;
  for (let i = 0; i < limit; i++) {
    const raw = await redis.lpop(dead);
    if (!raw) break;
    await redis.rpush(queueName, raw);
    replayed++;
  }
  return replayed;
}
