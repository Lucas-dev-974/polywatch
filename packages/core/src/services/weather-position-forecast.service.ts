import { DataSource } from 'typeorm';
import pino from 'pino';
import { WeatherPositionForecast } from '../entities/WeatherPositionForecast.js';

const log = pino({ name: 'core:weather-position-forecast' });

export interface WeatherPositionForecastInput {
  copiedPositionId: number;
  city: string;
  targetDate: Date;
  metric: string;
  unit?: 'celsius' | 'fahrenheit' | null;
  entryForecastMean: number;
  entryForecastStdDev: number;
  entryModelValues: Record<string, number>;
  /** Bucket comparison type at entry time (city-follow). Null for manual/expand entries. */
  entryBucketComparison?: 'exact' | 'between' | 'or_below' | 'or_above' | null;
  /** Bucket bounds at entry time (city-follow). Null for manual/expand entries. */
  entryBucketBounds?: { low?: number | null; high?: number | null; target?: number | null } | null;
  /** Strategy that opened the position (weather-algo). Null for manual/expand entries. */
  strategyId?: string | null;
}

export class WeatherPositionForecastService {
  constructor(private readonly ds: DataSource) {}

  async findByCopiedPositionId(
    copiedPositionId: number,
  ): Promise<WeatherPositionForecast | null> {
    return this.ds.getRepository(WeatherPositionForecast).findOne({
      where: { copiedPositionId },
    });
  }

  /** Insert snapshot once per position; no-op if already present. */
  async saveIfAbsent(input: WeatherPositionForecastInput): Promise<boolean> {
    const repo = this.ds.getRepository(WeatherPositionForecast);
    const existing = await repo.findOne({
      where: { copiedPositionId: input.copiedPositionId },
    });
    if (existing) return false;

    try {
      await repo.save({
        copiedPositionId: input.copiedPositionId,
        city: input.city,
        targetDate: input.targetDate,
        metric: input.metric,
        unit: input.unit ?? null,
        entryForecastMean: input.entryForecastMean,
        entryForecastStdDev: input.entryForecastStdDev,
        entryModelValues: JSON.stringify(input.entryModelValues),
        entryBucketComparison: input.entryBucketComparison ?? null,
        entryBucketBounds: input.entryBucketBounds ? JSON.stringify(input.entryBucketBounds) : null,
        strategyId: input.strategyId ?? null,
      });
      return true;
    } catch (err) {
      // Concurrent insert on unique index — treat as success.
      const dup = await repo.findOne({
        where: { copiedPositionId: input.copiedPositionId },
      });
      if (dup) return false;
      log.error({ err, copiedPositionId: input.copiedPositionId }, 'failed to save position forecast');
      throw err;
    }
  }
}
