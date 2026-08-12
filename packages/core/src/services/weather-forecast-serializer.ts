import type { WeatherPositionForecast } from '../entities/WeatherPositionForecast.js';

export interface WeatherForecastSnapshotDto {
  city: string;
  targetDate: string;
  metric: string;
  unit: 'celsius' | 'fahrenheit' | null;
  entryForecastMean: number;
  entryForecastStdDev: number;
  entryBucketComparison: string | null;
  entryBucketBounds: { low?: number; high?: number; target?: number } | null;
}

/**
 * Serialise a WeatherPositionForecast entity into the DTO shape consumed by
 * the frontend (parse the JSON `entryBucketBounds` column into an object).
 */
export function serializeWeatherForecast(
  row: WeatherPositionForecast,
): WeatherForecastSnapshotDto {
  let bounds: { low?: number; high?: number; target?: number } | null = null;
  if (row.entryBucketBounds) {
    try {
      const parsed = JSON.parse(row.entryBucketBounds) as Record<string, unknown>;
      bounds = {
        low: typeof parsed.low === 'number' ? parsed.low : undefined,
        high: typeof parsed.high === 'number' ? parsed.high : undefined,
        target: typeof parsed.target === 'number' ? parsed.target : undefined,
      };
    } catch {
      bounds = null;
    }
  }
  return {
    city: row.city,
    targetDate: row.targetDate.toISOString(),
    metric: row.metric,
    unit: row.unit === 'celsius' || row.unit === 'fahrenheit' ? row.unit : null,
    entryForecastMean: row.entryForecastMean,
    entryForecastStdDev: row.entryForecastStdDev,
    entryBucketComparison: row.entryBucketComparison,
    entryBucketBounds: bounds,
  };
}