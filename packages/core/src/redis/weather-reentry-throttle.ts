import type { Redis } from 'ioredis';
import type { TradingMode } from '../types/index.js';
import { normalizeWeatherCity } from '../weather/weather-exit-helpers.js';

export function weatherReentryThrottleKey(city: string, mode: TradingMode): string {
  return `weather-reentry:${normalizeWeatherCity(city)}:${mode}`;
}

export async function setWeatherReentryThrottle(
  redis: Pick<Redis, 'set'>,
  city: string,
  mode: TradingMode,
  ttlMs: number,
): Promise<void> {
  if (!city || ttlMs <= 0) return;
  const ttlSeconds = Math.max(1, Math.ceil(ttlMs / 1000));
  await redis.set(weatherReentryThrottleKey(city, mode), '1', 'EX', ttlSeconds);
}

export async function hasWeatherReentryThrottle(
  redis: Pick<Redis, 'exists'>,
  city: string,
  mode: TradingMode,
): Promise<boolean> {
  if (!city) return false;
  return (await redis.exists(weatherReentryThrottleKey(city, mode))) === 1;
}
