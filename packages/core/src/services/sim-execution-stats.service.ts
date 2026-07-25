import type { DataSource } from 'typeorm';
import { ClobLatencySample, ShadowFill } from '../entities/index.js';
import {
  MIN_LATENCY_SAMPLES_FOR_CALIBRATION,
  MAX_LATENCY_SAMPLES_LOAD,
} from '../risk/sim-execution-tunables.js';

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, idx))]!;
}

export interface SimExecutionStats {
  latencySampleCount: number;
  latencyP50Ms: number | null;
  latencyP90Ms: number | null;
  sufficientForCalibration: boolean;
  shadowFillCount: number;
  shadowAvgPriceDeltaPct: number | null;
  shadowAvgQtyDeltaPct: number | null;
}

export async function fetchSimExecutionStats(ds: DataSource): Promise<SimExecutionStats> {
  const [latencyRows, shadowAgg] = await Promise.all([
    ds.getRepository(ClobLatencySample).find({
      order: { createdAt: 'DESC' },
      take: MAX_LATENCY_SAMPLES_LOAD,
      select: ['rttMs'],
    }),
    ds
      .getRepository(ShadowFill)
      .createQueryBuilder('s')
      .select('COUNT(*)', 'count')
      .addSelect('AVG(s.price_delta_pct)', 'avgPriceDelta')
      .addSelect('AVG(s.qty_delta_pct)', 'avgQtyDelta')
      .getRawOne<{ count: string; avgPriceDelta: string | null; avgQtyDelta: string | null }>(),
  ]);

  const samples = latencyRows
    .map((r) => r.rttMs)
    .filter((n) => Number.isFinite(n) && n >= 0);
  const sorted = [...samples].sort((a, b) => a - b);

  const shadowFillCount = Number(shadowAgg?.count ?? 0);

  return {
    latencySampleCount: samples.length,
    latencyP50Ms: sorted.length > 0 ? percentile(sorted, 50) : null,
    latencyP90Ms: sorted.length > 0 ? percentile(sorted, 90) : null,
    sufficientForCalibration:
      samples.length >= MIN_LATENCY_SAMPLES_FOR_CALIBRATION,
    shadowFillCount,
    shadowAvgPriceDeltaPct:
      shadowAgg?.avgPriceDelta != null ? Number(shadowAgg.avgPriceDelta) : null,
    shadowAvgQtyDeltaPct:
      shadowAgg?.avgQtyDelta != null ? Number(shadowAgg.avgQtyDelta) : null,
  };
}
