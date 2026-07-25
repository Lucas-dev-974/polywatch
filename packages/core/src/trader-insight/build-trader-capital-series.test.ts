import { describe, expect, it } from 'vitest';
import {
  buildTraderCapitalSeries,
  filterCapitalActivities,
} from './build-trader-capital-series.js';

function activity(
  partial: Partial<{
    timestamp: number;
    type: string;
    side: string;
    usdcSize: number;
    size: number;
    price: number;
    conditionId: string;
  }> & { timestamp: number },
) {
  return {
    conditionId: '0xmarket',
    type: 'TRADE',
    usdcSize: 0,
    ...partial,
  };
}

describe('buildTraderCapitalSeries', () => {
  it('returns live-only point when no activity but live value exists', () => {
    const points = buildTraderCapitalSeries([], 1250);
    expect(points).toHaveLength(1);
    expect(points[0]!.value).toBe(1250);
    expect(points[0]!.isLive).toBe(true);
  });

  it('anchors the curve to the live portfolio value', () => {
    const t1 = Date.parse('2026-01-05T12:00:00.000Z') / 1000;
    const t2 = Date.parse('2026-01-12T12:00:00.000Z') / 1000;

    const points = buildTraderCapitalSeries(
      [
        activity({
          timestamp: t1,
          side: 'BUY',
          usdcSize: 100,
          size: 200,
          price: 0.5,
        }),
        activity({
          timestamp: t2,
          side: 'SELL',
          usdcSize: 140,
          size: 200,
          price: 0.7,
        }),
      ],
      1000,
    );

    expect(points.length).toBeGreaterThanOrEqual(2);
    expect(points[points.length - 1]!.value).toBe(1000);
    expect(points[points.length - 1]!.isLive).toBe(true);
    expect(points[0]!.value).toBeLessThan(1000);
  });

  it('includes redeem events in capital replay', () => {
    const filtered = filterCapitalActivities([
      activity({ timestamp: 1, side: 'BUY', usdcSize: 50, size: 100, price: 0.5 }),
      activity({ timestamp: 2, type: 'REDEEM', usdcSize: 80 }),
      activity({ timestamp: 3, type: 'SPLIT', usdcSize: 10 }),
    ]);

    expect(filtered).toHaveLength(2);
  });
});
