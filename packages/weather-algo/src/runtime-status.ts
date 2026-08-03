import type { Redis } from 'ioredis';
import { RUNTIME_STATUS_TTL_SECONDS } from './constants.js';

const RUNTIME_STATUS_KEY = 'weather-algo:runtime-status';

export interface WeatherAlgoRuntimeStatus {
  evaluableSelections: number;
  lastEvaluatedAt: number | null;
  lastSkipReason: string | null;
  lastSkipAt: number | null;
}

export class WeatherAlgoRuntimeStatusPublisher {
  constructor(private readonly redis: Redis) {}

  /**
   * Publish runtime status to Redis with a 5-minute TTL.
   * Caller is responsible for catching Redis errors (e.g. connection drops).
   */
  async publish(status: WeatherAlgoRuntimeStatus): Promise<void> {
    await this.redis.set(
      RUNTIME_STATUS_KEY,
      JSON.stringify(status),
      'EX',
      RUNTIME_STATUS_TTL_SECONDS,
    );
  }
}