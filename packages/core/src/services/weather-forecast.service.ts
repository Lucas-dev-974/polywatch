import { LessThan, DataSource } from 'typeorm';
import pino from 'pino';
import { WeatherForecastCache } from '../entities/WeatherForecastCache.js';
import { fetchWeatherForecast } from '../weather/weather-api-client.js';
import { isWeatherMetric, type WeatherMetric } from '../weather/metric.js';

const log = pino({ name: 'core:weather-forecast' });

export interface ForecastResult {
  city: string;
  forecastDate: Date;
  metric: WeatherMetric;
  forecastMean: number;
  forecastStdDev: number;
  modelValues: Record<string, number>;
  latitude: number;
  longitude: number;
  fetchedAt: Date;
  expiresAt: Date;
  isFresh: boolean;
}

export interface GetOrFetchResult {
  forecastMean: number;
  forecastStdDev: number;
  modelValues: Record<string, number>;
  latitude: number;
  longitude: number;
  fetchedAt: Date;
  expiresAt: Date;
  isFresh: boolean;
  isStaleFallback: boolean;
  wasFetched: boolean;
}

export class WeatherForecastService {
  constructor(private readonly ds: DataSource) {}

  /**
   * Get a forecast from cache or fetch from Open-Meteo and persist.
   * Returns null on failure with no stale cache.
   */
  async getOrFetch(
    city: string,
    forecastDate: Date,
    metric: WeatherMetric,
    ttlMs: number = 3600_000,
  ): Promise<GetOrFetchResult | null> {
    const cached = await this.getCached(city, forecastDate, metric);
    if (cached?.isFresh) {
      return {
        forecastMean: cached.forecastMean,
        forecastStdDev: cached.forecastStdDev,
        modelValues: cached.modelValues,
        latitude: cached.latitude,
        longitude: cached.longitude,
        fetchedAt: cached.fetchedAt,
        expiresAt: cached.expiresAt,
        isFresh: true,
        isStaleFallback: false,
        wasFetched: false,
      };
    }

    log.info({ city, forecastDate, metric }, 'fetching fresh weather forecast');
    const fresh = await fetchWeatherForecast(
      city,
      forecastDate,
      metric,
    );
    if (!fresh) {
      log.warn({ city, forecastDate }, 'forecast fetch failed');
      if (cached) {
        return {
          forecastMean: cached.forecastMean,
          forecastStdDev: cached.forecastStdDev,
          modelValues: cached.modelValues,
          latitude: cached.latitude,
          longitude: cached.longitude,
          fetchedAt: cached.fetchedAt,
          expiresAt: cached.expiresAt,
          isFresh: false,
          isStaleFallback: true,
          wasFetched: false,
        };
      }
      return null;
    }

    const expiresAt = new Date(Date.now() + ttlMs);
    const fetchedAt = new Date();
    await this.save({
      city,
      forecastDate,
      metric,
      forecastMean: fresh.forecastMean,
      forecastStdDev: fresh.forecastStdDev,
      modelValues: fresh.modelValues,
      latitude: fresh.latitude,
      longitude: fresh.longitude,
      fetchedAt,
      expiresAt,
      isFresh: true,
    });

    return {
      forecastMean: fresh.forecastMean,
      forecastStdDev: fresh.forecastStdDev,
      modelValues: fresh.modelValues,
      latitude: fresh.latitude,
      longitude: fresh.longitude,
      fetchedAt,
      expiresAt,
      isFresh: true,
      isStaleFallback: false,
      wasFetched: true,
    };
  }

  async getCached(
    city: string,
    forecastDate: Date,
    metric: WeatherMetric,
  ): Promise<ForecastResult | null> {
    const repo = this.ds.getRepository(WeatherForecastCache);
    const row = await repo.findOne({
      where: { city, forecastDate, metric },
      order: { fetchedAt: 'DESC' },
    });
    if (!row) return null;
    if (!isWeatherMetric(row.metric)) {
      log.warn({ city, forecastDate, metric: row.metric }, 'getCached: invalid metric in row — skipping');
      return null;
    }
    const isFresh = new Date(row.expiresAt) > new Date();
    return {
      city: row.city,
      forecastDate: row.forecastDate,
      metric: row.metric,
      forecastMean: row.forecastMean,
      forecastStdDev: row.forecastStdDev,
      modelValues: JSON.parse(row.modelValues),
      latitude: row.latitude,
      longitude: row.longitude,
      fetchedAt: row.fetchedAt,
      expiresAt: row.expiresAt,
      isFresh,
    };
  }

  async save(result: ForecastResult): Promise<void> {
    const repo = this.ds.getRepository(WeatherForecastCache);
    const existing = await repo.findOne({
      where: { city: result.city, forecastDate: result.forecastDate, metric: result.metric },
    });
    if (existing) {
      await repo.update(existing.id, {
        forecastMean: result.forecastMean,
        forecastStdDev: result.forecastStdDev,
        modelValues: JSON.stringify(result.modelValues),
        latitude: result.latitude,
        longitude: result.longitude,
        fetchedAt: result.fetchedAt,
        expiresAt: result.expiresAt,
      });
    } else {
      await repo.save({
        city: result.city,
        forecastDate: result.forecastDate,
        metric: result.metric,
        forecastMean: result.forecastMean,
        forecastStdDev: result.forecastStdDev,
        modelValues: JSON.stringify(result.modelValues),
        latitude: result.latitude,
        longitude: result.longitude,
        fetchedAt: result.fetchedAt,
        expiresAt: result.expiresAt,
      });
    }
  }

  async purgeExpired(): Promise<number> {
    const repo = this.ds.getRepository(WeatherForecastCache);
    const result = await repo.delete({ expiresAt: LessThan(new Date()) });
    return result.affected ?? 0;
  }
}
