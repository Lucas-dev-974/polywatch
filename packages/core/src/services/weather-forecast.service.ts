import { LessThan, MoreThan, DataSource } from 'typeorm';
import pino from 'pino';
import { WeatherForecastCache } from '../entities/WeatherForecastCache.js';

const log = pino({ name: 'core:weather-forecast' });

export interface ForecastResult {
  city: string;
  forecastDate: Date;
  metric: string;
  forecastMean: number;
  forecastStdDev: number;
  modelValues: Record<string, number>;
  latitude: number;
  longitude: number;
  fetchedAt: Date;
  expiresAt: Date;
  isFresh: boolean;
}

export class WeatherForecastService {
  constructor(private readonly ds: DataSource) {}

  async getCached(
    city: string,
    forecastDate: Date,
    metric: string,
  ): Promise<ForecastResult | null> {
    const repo = this.ds.getRepository(WeatherForecastCache);
    const row = await repo.findOne({
      where: { city, forecastDate, metric },
      order: { fetchedAt: 'DESC' },
    });
    if (!row) return null;
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
    // Upsert: find existing row by (city, forecastDate, metric) and update,
    // or insert if not found. Pass fetchedAt explicitly so it's refreshed
    // on update (GHOST-2 fix: @CreateDateColumn only fires on INSERT).
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