import { DataSource } from 'typeorm';
import { WeatherPositionForecast } from '../entities/WeatherPositionForecast.js';

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

  /** Insert snapshot once per position; no-op if already present (atomic). */
  async saveIfAbsent(input: WeatherPositionForecastInput): Promise<boolean> {
    const repo = this.ds.getRepository(WeatherPositionForecast);
    const result = await repo
      .createQueryBuilder()
      .insert()
      .into(WeatherPositionForecast)
      .values({
        copiedPositionId: input.copiedPositionId,
        city: input.city,
        targetDate: input.targetDate,
        metric: input.metric,
        unit: input.unit ?? null,
        entryForecastMean: input.entryForecastMean,
        entryForecastStdDev: input.entryForecastStdDev,
        entryModelValues: JSON.stringify(input.entryModelValues),
        entryBucketComparison: input.entryBucketComparison ?? null,
        entryBucketBounds: input.entryBucketBounds
          ? JSON.stringify(input.entryBucketBounds)
          : null,
        strategyId: input.strategyId ?? null,
      })
      .onConflict('("copied_position_id") DO NOTHING')
      .execute();
    return (result.raw?.length ?? 0) === 1;
  }
}
