import type { Redis } from 'ioredis';

const RUNTIME_STATUS_KEY = 'weather-algo:runtime-status';

export interface WeatherAlgoRuntimeStatus {
  evaluableSelections: number;
  lastEvaluatedAt: number | null;
  lastSkipReason: string | null;
  lastSkipAt: number | null;
}

export class WeatherAlgoRuntimeStatusPublisher {
  constructor(private readonly redis: Redis) {}

  async publish(status: WeatherAlgoRuntimeStatus): Promise<void> {
    await this.redis.set(
      RUNTIME_STATUS_KEY,
      JSON.stringify(status),
      'EX',
      300,
    );
  }
}

export function parseWeatherAlgoRuntimeStatus(
  raw: string | null,
): WeatherAlgoRuntimeStatus | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as WeatherAlgoRuntimeStatus;
  } catch {
    return null;
  }
}

export { RUNTIME_STATUS_KEY };