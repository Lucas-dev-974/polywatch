import { describe, expect, it } from 'vitest';
import {
  decimateUpDownPoints,
  usesCryptoChartResolution,
  type UpDownPricePoint,
} from './market-chart';

describe('usesCryptoChartResolution', () => {
  it('enables resolution mode for short crypto Up/Down intervals', () => {
    expect(usesCryptoChartResolution('BTC', '5m')).toBe(true);
    expect(usesCryptoChartResolution('ETH', '10m')).toBe(true);
    expect(usesCryptoChartResolution('SOL', '1h')).toBe(true);
  });

  it('keeps lookback mode for longer crypto or non-crypto', () => {
    expect(usesCryptoChartResolution('BTC', '4h')).toBe(false);
    expect(usesCryptoChartResolution('BTC', '1d')).toBe(false);
    expect(usesCryptoChartResolution('BTC', '15m')).toBe(false);
    expect(usesCryptoChartResolution(null, '5m')).toBe(false);
    expect(usesCryptoChartResolution('BTC', null)).toBe(false);
  });
});

describe('decimateUpDownPoints', () => {
  it('keeps one point per bucket (last tick)', () => {
    const points: UpDownPricePoint[] = [
      { t: 0, up: 0.4, down: 0.6 },
      { t: 20_000, up: 0.41, down: 0.59 },
      { t: 50_000, up: 0.42, down: 0.58 },
      { t: 60_000, up: 0.5, down: 0.5 },
      { t: 90_000, up: 0.55, down: 0.45 },
    ];
    const out = decimateUpDownPoints(points, 60_000);
    expect(out).toEqual([
      { t: 50_000, up: 0.42, down: 0.58 },
      { t: 90_000, up: 0.55, down: 0.45 },
    ]);
  });

  it('returns input unchanged for empty series or invalid bucket', () => {
    expect(decimateUpDownPoints([], 60_000)).toEqual([]);
    const single: UpDownPricePoint[] = [{ t: 1, up: 0.5, down: 0.5 }];
    expect(decimateUpDownPoints(single, 0)).toBe(single);
  });
});
