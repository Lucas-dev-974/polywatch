import { describe, expect, it } from 'vitest';
import { downsampleMinMax, filterBucketsByMinPrice } from './compute';
import type { ChartPoint } from './types';
import type { WeatherTimelineBucketData } from '../weather-timeline-types';

function pts(values: number[]): ChartPoint[] {
  return values.map((y, i) => ({ t: i * 1000, y }));
}

function bucket(conditionId: string, prices: number[]): WeatherTimelineBucketData {
  return {
    label: conditionId,
    fullLabel: conditionId,
    series: prices.map((y, i) => ({ t: i * 1000, y })),
    conditionId,
  };
}

describe('downsampleMinMax', () => {
  it('returns input unchanged when under the limit', () => {
    const p = pts([0.5, 0.6, 0.7]);
    expect(downsampleMinMax(p, 2000)).toBe(p);
  });

  it('returns input unchanged for empty or degenerate limits', () => {
    expect(downsampleMinMax([], 2000)).toEqual([]);
    const single = pts([0.5]);
    expect(downsampleMinMax(single, 2000)).toBe(single);
    expect(downsampleMinMax(pts([0.5, 0.6]), 1)).toEqual(pts([0.5, 0.6]));
  });

  it('caps the output size and preserves first/last points', () => {
    const p = pts(Array.from({ length: 10_000 }, (_, i) => 0.1 + (i % 7) * 0.1));
    const out = downsampleMinMax(p, 100);
    // Le downsampling min-max garde min ET max par bucket → jusqu'à 2× le budget.
    expect(out.length).toBeLessThanOrEqual(200);
    expect(out[0]).toEqual(p[0]);
    expect(out[out.length - 1]).toEqual(p[p.length - 1]);
  });

  it('keeps the global min and max of y', () => {
    const p = pts([0.5, 0.1, 0.9, 0.3, 0.2, 0.8, 0.4]);
    const out = downsampleMinMax(p, 3);
    const ys = out.map((q) => q.y);
    expect(ys).toContain(0.1);
    expect(ys).toContain(0.9);
  });

  it('preserves temporal order', () => {
    const p = pts(Array.from({ length: 5000 }, (_, i) => (i % 5) * 0.1));
    const out = downsampleMinMax(p, 50);
    for (let i = 1; i < out.length; i++) {
      expect(out[i]!.t).toBeGreaterThan(out[i - 1]!.t);
    }
  });
});

describe('filterBucketsByMinPrice', () => {
  it('returns all buckets when minPrice is 0', () => {
    const buckets = [bucket('a', [0.1]), bucket('b', [0.05])];
    expect(filterBucketsByMinPrice(buckets, 0)).toBe(buckets);
  });

  it('filters buckets below the threshold', () => {
    const buckets = [bucket('a', [0.5]), bucket('b', [0.05])];
    const out = filterBucketsByMinPrice(buckets, 0.2);
    expect(out.map((b) => b.conditionId)).toEqual(['a']);
  });

  it('keeps the alwaysShow bucket even below the threshold', () => {
    const buckets = [bucket('a', [0.5]), bucket('b', [0.05])];
    const out = filterBucketsByMinPrice(buckets, 0.2, 'b');
    expect(out.map((b) => b.conditionId)).toEqual(['a', 'b']);
  });

  it('ignores alwaysShowConditionId when it matches no bucket', () => {
    const buckets = [bucket('a', [0.5]), bucket('b', [0.05])];
    const out = filterBucketsByMinPrice(buckets, 0.2, 'zzz');
    expect(out.map((b) => b.conditionId)).toEqual(['a']);
  });
});
