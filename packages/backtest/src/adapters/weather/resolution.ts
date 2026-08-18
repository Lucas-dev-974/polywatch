import { isForecastInBucket, type BucketBounds } from '@polywatch/core';

export interface ResolutionInput {
  forecastMean: number | null;
  bucketComparison: string | null;
  bucketTarget: number | null;
  bucketLow: number | null;
  bucketHigh: number | null;
}

export interface ResolutionResult {
  /** True when the YES side wins (i.e. forecast mean falls in bucket). */
  winningOutcome: 'YES' | 'NO' | null;
}

/**
 * Resolves a weather bucket market by checking whether the forecast mean
 * falls inside the bucket bounds. There is no observed-temperature store, so
 * this is a documented proxy (fidelity warning is emitted by the runner).
 */
export function resolveWeatherBucket(input: ResolutionInput): ResolutionResult {
  if (input.forecastMean == null) {
    return { winningOutcome: null };
  }
  const comparison = input.bucketComparison as 'exact' | 'between' | 'or_below' | 'or_above';
  const bounds: BucketBounds = {
    low: input.bucketLow,
    high: input.bucketHigh,
    target: input.bucketTarget,
  };
  const inBucket = isForecastInBucket(input.forecastMean, comparison, bounds);
  // Forecast réel utilisé : pas de proxy.
  return { winningOutcome: inBucket ? 'YES' : 'NO' };
}
