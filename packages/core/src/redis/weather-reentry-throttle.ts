import type { Redis } from 'ioredis';
import type { TradingMode } from '../types/index.js';
import { normalizeWeatherCity } from '../weather/weather-exit-helpers.js';

export function weatherReentryThrottleKey(
  city: string,
  targetDateIso: string,
  mode: TradingMode,
): string {
  return `weather-reentry:${normalizeWeatherCity(city)}:${targetDateIso}:${mode}`;
}

export async function setWeatherReentryThrottle(
  redis: Pick<Redis, 'set'>,
  city: string,
  targetDateIso: string,
  mode: TradingMode,
  ttlMs: number,
): Promise<void> {
  if (!city || !targetDateIso || ttlMs <= 0) return;
  const ttlSeconds = Math.max(1, Math.ceil(ttlMs / 1000));
  await redis.set(weatherReentryThrottleKey(city, targetDateIso, mode), '1', 'EX', ttlSeconds);
}

export async function hasWeatherReentryThrottle(
  redis: Pick<Redis, 'exists'>,
  city: string,
  targetDateIso: string,
  mode: TradingMode,
): Promise<boolean> {
  if (!city || !targetDateIso) return false;
  return (await redis.exists(weatherReentryThrottleKey(city, targetDateIso, mode))) === 1;
}
