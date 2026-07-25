import type { DataSource } from 'typeorm';
import pino from 'pino';
import { WeatherForecastService, type ForecastResult } from '../services/weather-forecast.service.js';
import { fetchWeatherForecast } from './weather-api-client.js';
import type {
  CityMarketGroup,
  ForecastEnrichedCityGroup,
  ForecastStatus,
} from './weather-market-discovery.js';
import { resolveGroupTargetDate } from './weather-market-discovery.js';

const log = pino({ name: 'core:weather-forecast-enricher' });

export interface EnrichForecastOptions {
  /** Metric to forecast. Default: highest_temp. */
  metric?: 'highest_temp' | 'lowest_temp';
  /** Cache TTL in ms. Default: 1 hour. */
  ttlMs?: number;
}

/**
 * Enrich city groups with Open-Meteo temperature forecasts.
 *
 * Flow per group:
 *   1. Resolve target date from market question / endDate.
 *   2. Try DB cache first.
 *   3. If cache miss or stale, fetch from Open-Meteo in parallel.
 *   4. Save fresh results to cache (fire-and-forget).
 *
 * All groups are processed in parallel to keep discovery latency low.
 */
export async function enrichCityGroupsWithForecast(
  ds: DataSource,
  groups: CityMarketGroup[],
  options: EnrichForecastOptions = {},
): Promise<ForecastEnrichedCityGroup[]> {
  const metric = options.metric ?? 'highest_temp';
  const ttlMs = options.ttlMs ?? 3600_000;
  const forecastService = new WeatherForecastService(ds);

  const enriched = await Promise.all(
    groups.map(async (group): Promise<ForecastEnrichedCityGroup> => {
      const targetDate = resolveGroupTargetDate(group);
      const targetDateStr = targetDate.toISOString().slice(0, 10);

      try {
        log.info({ city: group.city, targetDate: targetDateStr, metric }, 'forecast enrichment start');
        const cached = await forecastService.getCached(group.city, targetDate, metric);

        if (cached?.isFresh) {
          log.info({ city: group.city, targetDate: targetDateStr, mean: cached.forecastMean, source: 'cache-fresh' }, 'forecast enrichment complete');
          return {
            ...group,
            targetDate: targetDateStr,
            forecastMean: cached.forecastMean,
            forecastStdDev: cached.forecastStdDev,
            forecastStatus: 'fresh',
          };
        }

        const fresh = await fetchWeatherForecast(group.city, targetDate, metric);
        if (!fresh) {
          log.warn({ city: group.city, targetDate: targetDateStr, hasCached: Boolean(cached) }, 'forecast fetch returned null');
          // Stale cache is better than nothing
          if (cached) {
            log.info({ city: group.city, targetDate: targetDateStr, mean: cached.forecastMean, source: 'cache-stale' }, 'forecast enrichment using stale cache');
            return {
              ...group,
              targetDate: targetDateStr,
              forecastMean: cached.forecastMean,
              forecastStdDev: cached.forecastStdDev,
              forecastStatus: 'stale',
            };
          }
          return {
            ...group,
            targetDate: targetDateStr,
            forecastMean: null,
            forecastStdDev: null,
            forecastStatus: 'unavailable',
          };
        }

        const result: ForecastResult = {
          city: group.city,
          forecastDate: targetDate,
          metric,
          forecastMean: fresh.forecastMean,
          forecastStdDev: fresh.forecastStdDev,
          modelValues: fresh.modelValues,
          latitude: fresh.latitude,
          longitude: fresh.longitude,
          fetchedAt: new Date(),
          expiresAt: new Date(Date.now() + ttlMs),
          isFresh: true,
        };

        // Save to cache without blocking the response
        forecastService.save(result).catch((err) => {
          log.warn({ err, city: group.city, date: targetDateStr }, 'failed to save forecast cache');
        });

        log.info({ city: group.city, targetDate: targetDateStr, mean: fresh.forecastMean, source: 'open-meteo' }, 'forecast enrichment complete');

        return {
          ...group,
          targetDate: targetDateStr,
          forecastMean: fresh.forecastMean,
          forecastStdDev: fresh.forecastStdDev,
          forecastStatus: 'fresh',
        };
      } catch (err) {
        log.warn({ err, city: group.city, date: targetDateStr }, 'forecast enrichment failed for city');
        return {
          ...group,
          targetDate: targetDateStr,
          forecastMean: null,
          forecastStdDev: null,
          forecastStatus: 'unavailable',
        };
      }
    }),
  );

  return enriched;
}
