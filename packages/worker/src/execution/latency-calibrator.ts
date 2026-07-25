import type { DataSource } from 'typeorm';
import {
  ClobLatencySample,
  MAX_LATENCY_SAMPLES_LOAD,
  MIN_LATENCY_SAMPLES_FOR_CALIBRATION,
  type SimExecutionTunables,
} from '@polywatch/core';

type LatencyCache = {
  samples: number[];
  loadedAt: number;
};

const CACHE_TTL_MS = 60_000;
let cache: LatencyCache | null = null;

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, idx))]!;
}

export async function loadLatencySamples(ds: DataSource): Promise<number[]> {
  if (cache && Date.now() - cache.loadedAt < CACHE_TTL_MS) {
    return cache.samples;
  }
  const rows = await ds.getRepository(ClobLatencySample).find({
    order: { createdAt: 'DESC' },
    take: MAX_LATENCY_SAMPLES_LOAD,
    select: ['rttMs'],
  });
  const samples = rows.map((r) => r.rttMs).filter((n) => Number.isFinite(n) && n >= 0);
  cache = { samples, loadedAt: Date.now() };
  return samples;
}

export function invalidateLatencySampleCache(): void {
  cache = null;
}

export async function sampleLatencyMs(
  ds: DataSource,
  tunables: SimExecutionTunables,
): Promise<number> {
  if (tunables.latencyMode !== 'calibrated') {
    return tunables.fixedLatencyMs;
  }
  const samples = await loadLatencySamples(ds);
  if (samples.length < MIN_LATENCY_SAMPLES_FOR_CALIBRATION) {
    return tunables.fixedLatencyMs;
  }
  const idx = Math.floor(Math.random() * samples.length);
  return samples[idx]!;
}

export async function latencyPercentiles(ds: DataSource): Promise<{
  sampleCount: number;
  p50Ms: number | null;
  p90Ms: number | null;
  sufficientForCalibration: boolean;
}> {
  const samples = await loadLatencySamples(ds);
  if (samples.length === 0) {
    return {
      sampleCount: 0,
      p50Ms: null,
      p90Ms: null,
      sufficientForCalibration: false,
    };
  }
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    sampleCount: samples.length,
    p50Ms: percentile(sorted, 50),
    p90Ms: percentile(sorted, 90),
    sufficientForCalibration: samples.length >= MIN_LATENCY_SAMPLES_FOR_CALIBRATION,
  };
}

export async function recordLatencySample(
  ds: DataSource,
  signalId: string,
  side: string,
  rttMs: number,
): Promise<void> {
  if (!Number.isFinite(rttMs) || rttMs < 0) return;
  await ds.getRepository(ClobLatencySample).insert({
    signalId,
    side,
    rttMs: Math.round(rttMs),
  });
  invalidateLatencySampleCache();
}
