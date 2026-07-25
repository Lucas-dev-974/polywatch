import { describe, expect, it, vi } from 'vitest';
import type { DataSource } from 'typeorm';
import { ClobLatencySample, ShadowFill } from '../entities/index.js';
import { fetchSimExecutionStats } from './sim-execution-stats.service.js';

describe('fetchSimExecutionStats', () => {
  it('returns null percentiles when no latency samples exist', async () => {
    const shadowQb = {
      select: vi.fn().mockReturnThis(),
      addSelect: vi.fn().mockReturnThis(),
      getRawOne: async () => ({
        count: '0',
        avgPriceDelta: null,
        avgQtyDelta: null,
      }),
    };

    const ds = {
      getRepository: (entity: unknown) => {
        if (entity === ClobLatencySample) {
          return { find: async () => [] };
        }
        if (entity === ShadowFill) {
          return { createQueryBuilder: () => shadowQb };
        }
        throw new Error('unexpected entity');
      },
    } as unknown as DataSource;

    const stats = await fetchSimExecutionStats(ds);
    expect(stats.latencySampleCount).toBe(0);
    expect(stats.latencyP50Ms).toBeNull();
    expect(stats.latencyP90Ms).toBeNull();
    expect(stats.sufficientForCalibration).toBe(false);
    expect(stats.shadowFillCount).toBe(0);
  });

  it('computes p50/p90 and marks calibration sufficient at 10+ samples', async () => {
    const samples = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    const shadowQb = {
      select: vi.fn().mockReturnThis(),
      addSelect: vi.fn().mockReturnThis(),
      getRawOne: async () => ({
        count: '3',
        avgPriceDelta: '0.01',
        avgQtyDelta: '-0.02',
      }),
    };

    const ds = {
      getRepository: (entity: unknown) => {
        if (entity === ClobLatencySample) {
          return {
            find: async () => samples.map((rttMs) => ({ rttMs })),
          };
        }
        if (entity === ShadowFill) {
          return { createQueryBuilder: () => shadowQb };
        }
        throw new Error('unexpected entity');
      },
    } as unknown as DataSource;

    const stats = await fetchSimExecutionStats(ds);
    expect(stats.latencySampleCount).toBe(10);
    expect(stats.latencyP50Ms).toBe(50);
    expect(stats.latencyP90Ms).toBe(90);
    expect(stats.sufficientForCalibration).toBe(true);
    expect(stats.shadowFillCount).toBe(3);
    expect(stats.shadowAvgPriceDeltaPct).toBeCloseTo(0.01);
    expect(stats.shadowAvgQtyDeltaPct).toBeCloseTo(-0.02);
  });
});
