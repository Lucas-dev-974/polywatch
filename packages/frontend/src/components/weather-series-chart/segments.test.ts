import { describe, expect, it } from 'vitest';
import { splitSegments } from './segments';
import type { WeatherTimelineSeriesPoint } from '../weather-timeline-types';

function pts(values: Array<number | null>): WeatherTimelineSeriesPoint[] {
  return values.map((y, i) => ({ t: i * 1000, y }));
}

describe('splitSegments', () => {
  it('returns a single segment when no gaps or nulls', () => {
    const out = splitSegments(pts([0.5, 0.6, 0.7]));
    expect(out).toEqual([
      [
        { t: 0, y: 0.5 },
        { t: 1000, y: 0.6 },
        { t: 2000, y: 0.7 },
      ],
    ]);
  });

  it('cuts at explicit null points', () => {
    const out = splitSegments(pts([0.5, null, 0.7]));
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual([{ t: 0, y: 0.5 }]);
    expect(out[1]).toEqual([{ t: 2000, y: 0.7 }]);
  });

  it('cuts at implicit gaps larger than 3× the median gap', () => {
    const series: WeatherTimelineSeriesPoint[] = [
      { t: 0, y: 0.5 },
      { t: 1000, y: 0.6 },
      { t: 2000, y: 0.7 },
      { t: 3000, y: 0.8 },
      { t: 20_000, y: 0.4 },
      { t: 21_000, y: 0.5 },
    ];
    const out = splitSegments(series);
    expect(out).toHaveLength(2);
    expect(out[0]).toHaveLength(4);
    expect(out[1]).toHaveLength(2);
  });

  it('handles very long series without freezing (sampling path)', () => {
    const series: WeatherTimelineSeriesPoint[] = Array.from(
      { length: 20_000 },
      (_, i) => ({ t: i * 1000, y: 0.1 + (i % 5) * 0.1 }),
    );
    const out = splitSegments(series);
    expect(out).toHaveLength(1);
    expect(out[0]).toHaveLength(20_000);
  });

  it('returns empty array for all-null series', () => {
    expect(splitSegments(pts([null, null, null]))).toEqual([]);
  });

  it('returns empty array for empty series', () => {
    expect(splitSegments([])).toEqual([]);
  });
});