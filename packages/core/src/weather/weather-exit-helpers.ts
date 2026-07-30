/**
 * Pure helpers for weather-algo exit evaluation.
 */

export interface BucketBounds {
  low?: number | null;
  high?: number | null;
  target?: number | null;
}

export function shouldCloseForForecastDrift(
  entryMean: number,
  currentMean: number,
  threshold: number,
): boolean {
  if (!Number.isFinite(entryMean) || !Number.isFinite(currentMean) || threshold <= 0) {
    return false;
  }
  return Math.abs(currentMean - entryMean) > threshold;
}

export function shouldCloseBeforeResolution(
  hoursToEnd: number,
  closeBeforeHours: number,
): boolean {
  if (!Number.isFinite(hoursToEnd) || closeBeforeHours <= 0) return false;
  return hoursToEnd <= closeBeforeHours;
}

/**
 * Check whether a forecast mean falls inside a given temperature bucket.
 */
export function isForecastInBucket(
  forecastMean: number,
  comparison: 'exact' | 'between' | 'or_below' | 'or_above',
  bounds: BucketBounds,
): boolean {
  switch (comparison) {
    case 'between': {
      const low = bounds.low ?? -Infinity;
      const high = bounds.high ?? Infinity;
      return forecastMean >= low - 0.5 && forecastMean <= high + 0.5;
    }
    case 'exact': {
      const target = bounds.target ?? NaN;
      return Math.abs(forecastMean - target) <= 0.5;
    }
    case 'or_below': {
      const target = bounds.target ?? NaN;
      return forecastMean <= target;
    }
    case 'or_above': {
      const target = bounds.target ?? NaN;
      return forecastMean >= target;
    }
    default:
      return false;
  }
}

/**
 * Close when the forecast mean has left the entry bucket.
 * Returns false for null comparison/bounds (rétro-compat = hold behaviour).
 */
export function shouldCloseForBucketExit(
  entryComparison: 'exact' | 'between' | 'or_below' | 'or_above' | null,
  entryBounds: BucketBounds | null,
  currentMean: number,
): boolean {
  if (!entryComparison || !entryBounds) return false;
  return !isForecastInBucket(currentMean, entryComparison, entryBounds);
}

export type WeatherCityFollowSwitchMode = 'close_and_reenter' | 'hold';

/** Normalize config value; unknown / add_position → close_and_reenter. */
export function resolveCityFollowSwitchMode(raw: string | null | undefined): WeatherCityFollowSwitchMode {
  return raw === 'hold' ? 'hold' : 'close_and_reenter';
}

/**
 * Whether bucket-leave should trigger a close under the configured switch mode.
 * Hysteresis is applied by the caller (consecutive polls out of bucket).
 */
export function shouldEmitBucketExit(
  switchMode: WeatherCityFollowSwitchMode,
  leftBucket: boolean,
  consecutiveOutPolls: number,
  hysteresisPolls: number,
): boolean {
  if (!leftBucket) return false;
  if (switchMode === 'hold') return false;
  const need = Math.max(1, hysteresisPolls);
  return consecutiveOutPolls >= need;
}

export function normalizeWeatherCity(city: string): string {
  return city.trim().toLowerCase();
}

/** UTC calendar dates from today through today + (lookAheadDays - 1). */
export function buildLookAheadTargetDates(lookAheadDays: number, now = new Date()): Date[] {
  const days = Math.max(1, Math.min(30, Math.floor(lookAheadDays)));
  const base = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12));
  const dates: Date[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() + i);
    dates.push(d);
  }
  return dates;
}
