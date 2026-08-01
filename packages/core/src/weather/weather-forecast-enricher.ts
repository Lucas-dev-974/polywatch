import type { DataSource } from 'typeorm';
import pino from 'pino';
import { WeatherForecastService, type ForecastResult } from '../services/weather-forecast.service.js';
import { fetchWeatherForecast } from './weather-api-client.js';
import type {
  DiscoverCityGroup,
  ForecastEnrichedCityGroup,
  ForecastEnrichedDateBucket,
  ForecastStatus,
} from './weather-market-discovery.js';

const log = pino({ name: 'core:weather-forecast-enricher' });

export interface EnrichForecastOptions {
  /** Metric to forecast. Default: highest_temp. */
  metric?: 'highest_temp' | 'lowest_temp';
  /** Cache TTL in ms. Default: 1 hour. */
  ttlMs?: number;
}

async function enrichDateBucket(
  city: string,
  dateIso: string,
  markets: ForecastEnrichedDateBucket['markets'],
  dateLabel: string,
  forecastService: WeatherForecastService,
  metric: 'highest_temp' | 'lowest_temp',
  ttlMs: number,
): Promise<ForecastEnrichedDateBucket> {
  const makeBucket = (
    status: ForecastStatus,
    mean: number | null = null,
    stdDev: number | null = null,
  ): ForecastEnrichedDateBucket => ({
    date: dateIso,
    dateLabel,
    markets,
    forecastMean: mean,
    forecastStdDev: stdDev,
    forecastStatus: status,
  });

  if (dateIso === 'unknown' || city === 'Autres') {
    return makeBucket('unavailable');
  }

  const targetDate = new Date(`${dateIso}T12:00:00Z`);
  if (Number.isNaN(targetDate.getTime())) {
    return makeBucket('unavailable');
  }

  try {
    log.info({ city, targetDate: dateIso, metric }, 'forecast enrichment start');
    const cached = await forecastService.getCached(city, targetDate, metric);

    if (cached?.isFresh) {
      log.info(
        { city, targetDate: dateIso, mean: cached.forecastMean, source: 'cache-fresh' },
        'forecast enrichment complete',
      );
      return makeBucket('fresh', cached.forecastMean, cached.forecastStdDev);
    }

    const fresh = await fetchWeatherForecast(city, targetDate, metric);
    if (!fresh) {
      log.warn({ city, targetDate: dateIso, hasCached: Boolean(cached) }, 'forecast fetch returned null');
      if (cached) {
        log.info(
          { city, targetDate: dateIso, mean: cached.forecastMean, source: 'cache-stale' },
          'forecast enrichment using stale cache',
        );
        return makeBucket('stale', cached.forecastMean, cached.forecastStdDev);
      }
      return makeBucket('unavailable');
    }

    const result: ForecastResult = {
      city,
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

    forecastService.save(result).catch((err) => {
      log.warn({ err, city, date: dateIso }, 'failed to save forecast cache');
    });

    log.info(
      { city, targetDate: dateIso, mean: fresh.forecastMean, source: 'open-meteo' },
      'forecast enrichment complete',
    );

    return makeBucket('fresh', fresh.forecastMean, fresh.forecastStdDev);
  } catch (err) {
    log.warn({ err, city, date: dateIso }, 'forecast enrichment failed for city/date');
    try {
      const cached = await forecastService.getCached(city, targetDate, metric);
      if (cached) {
        log.info(
          { city, targetDate: dateIso, mean: cached.forecastMean, source: 'cache-stale' },
          'forecast enrichment using stale cache after error',
        );
        return makeBucket('stale', cached.forecastMean, cached.forecastStdDev);
      }
    } catch {
      // ignore secondary cache lookup failure
    }
    return makeBucket('unavailable');
  }
}

/**
 * Enrich city → date discovery groups with Open-Meteo forecasts per date bucket.
 */
export async function enrichCityGroupsWithForecast(
  ds: DataSource,
  groups: DiscoverCityGroup[],
  options: EnrichForecastOptions = {},
): Promise<ForecastEnrichedCityGroup[]> {
  const metric = options.metric ?? 'highest_temp';
  const ttlMs = options.ttlMs ?? 3600_000;
  const forecastService = new WeatherForecastService(ds);

  return Promise.all(
    groups.map(async (group): Promise<ForecastEnrichedCityGroup> => {
      const dates = await Promise.all(
        group.dates.map((bucket) =>
          enrichDateBucket(
            group.city,
            bucket.date,
            bucket.markets,
            bucket.dateLabel,
            forecastService,
            metric,
            ttlMs,
          ),
        ),
      );
      return {
        city: group.city,
        cityLabel: group.cityLabel,
        dates,
      };
    }),
  );
}
