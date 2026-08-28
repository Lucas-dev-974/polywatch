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

/** Pre per-mode deployments omitted the trailing `:mode` segment. */
export function weatherReentryCountLegacyKey(
  city: string,
  targetDateIso: string,
  strategyId: string,
): string {
  return `weather-entry-count:${normalizeWeatherCity(city)}:${targetDateIso}:${strategyId}`;
}

function parseReentryCount(raw: string | null): number {
  const n = raw != null ? Number(raw) : 0;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

export async function getWeatherReentryCount(
  redis: Pick<Redis, 'get'>,
  city: string,
  targetDateIso: string,
  strategyId: string,
  mode: TradingMode,
): Promise<number> {
  if (!city || !targetDateIso || !strategyId) return 0;
  const current = parseReentryCount(
    await redis.get(weatherReentryCountKey(city, targetDateIso, strategyId, mode)),
  );
  const legacy = parseReentryCount(
    await redis.get(weatherReentryCountLegacyKey(city, targetDateIso, strategyId)),
  );
  return Math.max(current, legacy);
}

export async function incrementWeatherReentryCount(
  redis: Pick<Redis, 'incr' | 'get' | 'set'>,
  city: string,
  targetDateIso: string,
  strategyId: string,
  mode: TradingMode,
): Promise<number> {
  if (!city || !targetDateIso || !strategyId) return 0;
  const key = weatherReentryCountKey(city, targetDateIso, strategyId, mode);
  const raw = await redis.get(key);
  if (raw == null) {
    const legacy = parseReentryCount(
      await redis.get(weatherReentryCountLegacyKey(city, targetDateIso, strategyId)),
    );
    if (legacy > 0) {
      await redis.set(key, String(legacy));
    }
  }
  return redis.incr(key);
}

/** 0 = unlimited. */
export function isWeatherReentryCountBlocked(count: number, maxEntries: number): boolean {
  return maxEntries > 0 && count >= maxEntries;
}
