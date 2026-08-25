import type { DataSource } from 'typeorm';
import type { Redis } from 'ioredis';
import type { WeatherConfig } from '../entities/WeatherConfig.js';
import type { CopiedPosition } from '../entities/CopiedPosition.js';
import { WeatherPositionForecast } from '../entities/WeatherPositionForecast.js';
import {
  WEATHER_FORECAST_STRATEGY_ID,
  getStrategyParams,
} from './strategy-catalog.js';
import { setWeatherReentryThrottle } from '../redis/weather-reentry-throttle.js';

/**
 * After a weather position SL close signal is emitted, pause re-entry on the
 * same city+date (Redis TTL), mirroring bucket/drift throttle for SL exits.
 */
export async function applyWeatherReentryThrottleAfterSl(opts: {
  redis: Pick<Redis, 'set'>;
  ds: DataSource;
  position: Pick<CopiedPosition, 'id' | 'reason' | 'mode' | 'strategyId'>;
  weatherConfig: WeatherConfig;
}): Promise<void> {
  if (opts.position.reason !== 'WEATHER_OPEN') return;

  const snapshot = await opts.ds.getRepository(WeatherPositionForecast).findOne({
    where: { copiedPositionId: opts.position.id },
  });
  if (!snapshot) return;

  const strategyId =
    snapshot.strategyId ?? opts.position.strategyId ?? WEATHER_FORECAST_STRATEGY_ID;
  const bag = getStrategyParams(opts.weatherConfig, strategyId);
  if (bag.reentryThrottleAfterSlMs <= 0) return;

  const targetDateIso = snapshot.targetDate.toISOString().slice(0, 10);
  await setWeatherReentryThrottle(
    opts.redis,
    snapshot.city,
    targetDateIso,
    opts.position.mode as 'sim' | 'real',
    bag.reentryThrottleAfterSlMs,
  );
}
