import { describe, it, expect } from 'vitest';
import {
  buildStrategyCycleMetricsSnapshot,
  shouldRecordExitMetric,
} from './strategy-cycle-metrics.js';

describe('buildStrategyCycleMetricsSnapshot', () => {
  it('returns stable zero snapshot for empty position set', () => {
    expect(buildStrategyCycleMetricsSnapshot([], 12)).toEqual({
      durationMs: 12,
      positionsEvaluated: 0,
      positionsOpen: 0,
      positionsOpenByMode: { sim: 0, real: 0 },
      positionsByStatus: {},
      illiquidPositions: 0,
      spreadMean: 0,
    });
  });

  it('counts positions_open_by_mode for open status only', () => {
    const snapshot = buildStrategyCycleMetricsSnapshot(
      [
        { status: 'open', mode: 'sim', liquidityStatus: 'liquid' },
        { status: 'open', mode: 'sim', liquidityStatus: 'liquid' },
        { status: 'closing', mode: 'sim', liquidityStatus: 'liquid' },
        { status: 'open', mode: 'real', liquidityStatus: 'illiquid' },
        { status: 'failed', mode: 'real', liquidityStatus: 'liquid' },
      ],
      5,
    );

    expect(snapshot.positionsOpen).toBe(3);
    expect(snapshot.positionsOpenByMode).toEqual({ sim: 2, real: 1 });
    expect(snapshot.positionsByStatus).toEqual({
      open: 3,
      closing: 1,
      failed: 1,
    });
    expect(snapshot.illiquidPositions).toBe(1);
    expect(snapshot.positionsEvaluated).toBe(5);
  });

  it('computes relative drift spread for liquid positions with both VWAPs', () => {
    // |0.40 - 0.60| / 0.50 = 0.4
    const snapshot = buildStrategyCycleMetricsSnapshot(
      [
        {
          status: 'open',
          mode: 'sim',
          liquidityStatus: 'liquid',
          executableBidVwap: 0.4,
          lastCloseableBidVwap: 0.6,
        },
        {
          status: 'open',
          mode: 'sim',
          liquidityStatus: 'illiquid',
          executableBidVwap: 0.1,
          lastCloseableBidVwap: 0.9,
        },
      ],
      1,
    );
    expect(snapshot.spreadMean).toBeCloseTo(0.4, 6);
  });
});

describe('shouldRecordExitMetric', () => {
  it('includes forced-exit reasons only', () => {
    expect(shouldRecordExitMetric('SL')).toBe(true);
    expect(shouldRecordExitMetric('PRE_CLOSE_LOSS')).toBe(true);
    expect(shouldRecordExitMetric('WEATHER_PRE_CLOSE')).toBe(true);
    expect(shouldRecordExitMetric('COPY_CLOSE')).toBe(false);
    expect(shouldRecordExitMetric('MANUAL')).toBe(false);
  });
});
