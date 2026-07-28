import { describe, expect, it } from 'vitest';
import {
  selectForecastAlignedBucket,
  type BucketCandidate,
} from './forecast-bucket-selector.js';
import { isForecastInBucket } from './weather-exit-helpers.js';
import type { ParsedWeatherQuestion } from './question-parser.js';

function makeBucket(
  conditionId: string,
  overrides: Partial<ParsedWeatherQuestion>,
): BucketCandidate {
  const defaults: ParsedWeatherQuestion = {
    city: 'Paris',
    metric: 'highest_temp',
    targetValue: null,
    targetValueLow: null,
    targetValueHigh: null,
    dateString: 'July 25',
    comparison: 'exact',
    unit: 'celsius',
  };
  return {
    conditionId,
    market: { conditionId } as any,
    parsed: { ...defaults, ...overrides },
  };
}

describe('isForecastInBucket', () => {
  it('exact: matches within 0.5°C', () => {
    expect(isForecastInBucket(31.2, 'exact', { target: 31 })).toBe(true);
    expect(isForecastInBucket(31.6, 'exact', { target: 31 })).toBe(false);
    expect(isForecastInBucket(30.5, 'exact', { target: 31 })).toBe(true);
  });

  it('between: matches within low-0.5 to high+0.5', () => {
    expect(isForecastInBucket(33, 'between', { low: 32, high: 34 })).toBe(true);
    expect(isForecastInBucket(31.4, 'between', { low: 32, high: 34 })).toBe(false);
    expect(isForecastInBucket(34.5, 'between', { low: 32, high: 34 })).toBe(true);
    expect(isForecastInBucket(34.6, 'between', { low: 32, high: 34 })).toBe(false);
  });

  it('or_below: matches when forecastMean <= target', () => {
    expect(isForecastInBucket(28, 'or_below', { target: 30 })).toBe(true);
    expect(isForecastInBucket(30, 'or_below', { target: 30 })).toBe(true);
    expect(isForecastInBucket(31, 'or_below', { target: 30 })).toBe(false);
  });

  it('or_above: matches when forecastMean >= target', () => {
    expect(isForecastInBucket(35, 'or_above', { target: 35 })).toBe(true);
    expect(isForecastInBucket(36, 'or_above', { target: 35 })).toBe(true);
    expect(isForecastInBucket(34, 'or_above', { target: 35 })).toBe(false);
  });
});

describe('selectForecastAlignedBucket', () => {
  it('returns null for empty buckets', () => {
    expect(selectForecastAlignedBucket(33, [])).toBeNull();
  });

  it('selects exact bucket when forecast matches', () => {
    const buckets = [
      makeBucket('a', { comparison: 'exact', targetValue: 30 }),
      makeBucket('b', { comparison: 'exact', targetValue: 31 }),
      makeBucket('c', { comparison: 'exact', targetValue: 32 }),
    ];
    const result = selectForecastAlignedBucket(31.2, buckets);
    expect(result).not.toBeNull();
    expect(result!.conditionId).toBe('b');
  });

  it('prefers between over exact when both match', () => {
    const buckets = [
      makeBucket('exact', { comparison: 'exact', targetValue: 33 }),
      makeBucket('between', {
        comparison: 'between',
        targetValueLow: 32,
        targetValueHigh: 34,
      }),
    ];
    const result = selectForecastAlignedBucket(33, buckets);
    expect(result).not.toBeNull();
    expect(result!.conditionId).toBe('between');
  });

  it('prefers exact over or_above when both match', () => {
    const buckets = [
      makeBucket('or_above', { comparison: 'or_above', targetValue: 30 }),
      makeBucket('exact', { comparison: 'exact', targetValue: 33 }),
    ];
    const result = selectForecastAlignedBucket(33, buckets);
    expect(result).not.toBeNull();
    expect(result!.conditionId).toBe('exact');
  });

  it('falls back to or_below when no exact/between matches', () => {
    const buckets = [
      makeBucket('or_below', { comparison: 'or_below', targetValue: 25 }),
      makeBucket('exact', { comparison: 'exact', targetValue: 30 }),
    ];
    const result = selectForecastAlignedBucket(24, buckets);
    expect(result).not.toBeNull();
    expect(result!.conditionId).toBe('or_below');
  });

  it('falls back to or_above when no exact/between matches', () => {
    const buckets = [
      makeBucket('or_above', { comparison: 'or_above', targetValue: 35 }),
      makeBucket('exact', { comparison: 'exact', targetValue: 30 }),
    ];
    const result = selectForecastAlignedBucket(36, buckets);
    expect(result).not.toBeNull();
    expect(result!.conditionId).toBe('or_above');
  });

  it('picks closest centre when multiple same-tier buckets match', () => {
    const buckets = [
      makeBucket('far', { comparison: 'exact', targetValue: 30 }),
      makeBucket('close', { comparison: 'exact', targetValue: 33 }),
      makeBucket('far2', { comparison: 'exact', targetValue: 36 }),
    ];
    const result = selectForecastAlignedBucket(33.2, buckets);
    expect(result).not.toBeNull();
    expect(result!.conditionId).toBe('close');
  });

  it('returns null when no bucket matches (forecast outside all ranges)', () => {
    const buckets = [
      makeBucket('a', { comparison: 'exact', targetValue: 30 }),
      makeBucket('b', { comparison: 'exact', targetValue: 31 }),
    ];
    expect(selectForecastAlignedBucket(35, buckets)).toBeNull();
  });

  it('handles between with centre tie-breaking', () => {
    const buckets = [
      makeBucket('a', {
        comparison: 'between',
        targetValueLow: 30,
        targetValueHigh: 32,
      }),
      makeBucket('b', {
        comparison: 'between',
        targetValueLow: 33,
        targetValueHigh: 35,
      }),
    ];
    const result = selectForecastAlignedBucket(32.5, buckets);
    expect(result).not.toBeNull();
    expect(result!.conditionId).toBe('a');
  });
});
