import { describe, expect, it } from 'vitest';
import {
  shouldCloseForForecastDrift,
  shouldCloseBeforeResolution,
  shouldCloseForBucketExit,
  shouldEmitBucketExit,
  resolveCityFollowSwitchMode,
  isForecastInBucket,
  normalizeWeatherCity,
  buildLookAheadTargetDates,
} from './weather-exit-helpers.js';

describe('weather-exit-helpers', () => {
  it('detects forecast drift above threshold', () => {
    expect(shouldCloseForForecastDrift(20, 23, 2)).toBe(true);
    expect(shouldCloseForForecastDrift(20, 21.5, 2)).toBe(false);
  });

  it('detects pre-close window', () => {
    expect(shouldCloseBeforeResolution(0.5, 1)).toBe(true);
    expect(shouldCloseBeforeResolution(2, 1)).toBe(false);
  });

  it('normalizes city names', () => {
    expect(normalizeWeatherCity(' Hong Kong ')).toBe('hong kong');
  });

  it('builds look-ahead UTC dates', () => {
    const dates = buildLookAheadTargetDates(3, new Date('2026-07-25T15:00:00Z'));
    expect(dates).toHaveLength(3);
    expect(dates[0]!.toISOString().slice(0, 10)).toBe('2026-07-25');
    expect(dates[2]!.toISOString().slice(0, 10)).toBe('2026-07-27');
  });

  describe('isForecastInBucket', () => {
    it('exact: matches within 0.5°C', () => {
      expect(isForecastInBucket(31.2, 'exact', { target: 31 })).toBe(true);
      expect(isForecastInBucket(31.6, 'exact', { target: 31 })).toBe(false);
    });

    it('between: matches within low-0.5 to high+0.5', () => {
      expect(isForecastInBucket(33, 'between', { low: 32, high: 34 })).toBe(true);
      expect(isForecastInBucket(34.6, 'between', { low: 32, high: 34 })).toBe(false);
    });

    it('or_below: matches when forecastMean <= target', () => {
      expect(isForecastInBucket(28, 'or_below', { target: 30 })).toBe(true);
      expect(isForecastInBucket(31, 'or_below', { target: 30 })).toBe(false);
    });

    it('or_below: applies the +0.5 bin tolerance at the boundary', () => {
      // bin 30 couvre [29.5, 30.5) → mean 30.4 est dans le bucket
      expect(isForecastInBucket(30.4, 'or_below', { target: 30 })).toBe(true);
      expect(isForecastInBucket(30.6, 'or_below', { target: 30 })).toBe(false);
    });

    it('or_above: matches when forecastMean >= target', () => {
      expect(isForecastInBucket(35, 'or_above', { target: 35 })).toBe(true);
      expect(isForecastInBucket(34, 'or_above', { target: 35 })).toBe(false);
    });

    it('or_above: applies the -0.5 bin tolerance at the boundary', () => {
      // bin 35 couvre [34.5, 35.5) → mean 34.6 est dans le bucket
      expect(isForecastInBucket(34.6, 'or_above', { target: 35 })).toBe(true);
      expect(isForecastInBucket(34.4, 'or_above', { target: 35 })).toBe(false);
    });
  });

  describe('shouldCloseForBucketExit', () => {
    it('returns false when entryComparison is null (rétro-compat)', () => {
      expect(shouldCloseForBucketExit(null, { target: 30 }, 35)).toBe(false);
    });

    it('returns false when entryBounds is null (rétro-compat)', () => {
      expect(shouldCloseForBucketExit('exact', null, 35)).toBe(false);
    });

    it('returns true when forecast leaves the bucket', () => {
      expect(shouldCloseForBucketExit('exact', { target: 30 }, 35)).toBe(true);
    });

    it('returns false when forecast stays in the bucket', () => {
      expect(shouldCloseForBucketExit('between', { low: 30, high: 32 }, 31.5)).toBe(false);
    });
  });

  describe('resolveCityFollowSwitchMode', () => {
    it('maps hold and defaults everything else to close_and_reenter', () => {
      expect(resolveCityFollowSwitchMode('hold')).toBe('hold');
      expect(resolveCityFollowSwitchMode('close_and_reenter')).toBe('close_and_reenter');
      expect(resolveCityFollowSwitchMode('add_position')).toBe('close_and_reenter');
      expect(resolveCityFollowSwitchMode(null)).toBe('close_and_reenter');
    });
  });

  describe('shouldEmitBucketExit', () => {
    it('never emits in hold mode', () => {
      expect(shouldEmitBucketExit('hold', true, 10, 2)).toBe(false);
    });

    it('respects hysteresis for close_and_reenter', () => {
      expect(shouldEmitBucketExit('close_and_reenter', true, 1, 2)).toBe(false);
      expect(shouldEmitBucketExit('close_and_reenter', true, 2, 2)).toBe(true);
      expect(shouldEmitBucketExit('close_and_reenter', false, 5, 2)).toBe(false);
    });
  });
});
