import type { Redis } from 'ioredis';
import type { TradingMode } from '../types/index.js';
import { normalizeWeatherCity } from '../weather/weather-exit-helpers.js';

export function weatherReentryCountKey(
  city: string,
  targetDateIso: string,
  strategyId: string,
  mode: TradingMode,
): string {
  return `weather-entry-count:${normalizeWeatherCity(city)}:${targetDateIso}:${strategyId}:${mode}`;
}

export async function getWeatherReentryCount(
  redis: Pick<Redis, 'get'>,
  city: string,
  targetDateIso: string,
  strategyId: string,
  mode: TradingMode,
): Promise<number> {
  if (!city || !targetDateIso || !strategyId) return 0;
  const raw = await redis.get(weatherReentryCountKey(city, targetDateIso, strategyId, mode));
  const n = raw != null ? Number(raw) : 0;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

export async function incrementWeatherReentryCount(
  redis: Pick<Redis, 'incr'>,
  city: string,
  targetDateIso: string,
  strategyId: string,
  mode: TradingMode,
): Promise<number> {
  if (!city || !targetDateIso || !strategyId) return 0;
  return redis.incr(weatherReentryCountKey(city, targetDateIso, strategyId, mode));
}

/** 0 = unlimited. */
export function isWeatherReentryCountBlocked(count: number, maxEntries: number): boolean {
  return maxEntries > 0 && count >= maxEntries;
}
