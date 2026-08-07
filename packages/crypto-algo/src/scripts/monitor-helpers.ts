/**
 * Pure helpers extracted from monitor.ts for unit testing.
 * These functions have no side effects and no external dependencies,
 * making them safe to test in isolation without a database or Redis.
 */

export interface SignalRow {
  conditionId: string;
  interval: string | null;
  lastSignalOutcome: string | null;
  lastSignalConfidence: number | null;
  lastSignalStrategyId: string | null;
  lastAbstainReason: string | null;
  upPrice: number | null;
  downPrice: number | null;
  upSpreadPct: number | null;
  downSpreadPct: number | null;
  wsHealthy: boolean | null;
  openPositionsCount: number;
  openExposureUsd: number | null;
  unrealizedPnl: number | null;
  recordedAt: Date;
}

export function sanitizePositiveNumber(
  raw: string | undefined,
  fallback: number,
  opts: { min: number; max?: number },
): number {
  const n = Number(raw ?? fallback);
  if (!Number.isFinite(n) || n < opts.min) return fallback;
  return opts.max != null ? Math.min(n, opts.max) : n;
}

export function toFixed(n: number | null | undefined, digits = 4): number | null {
  if (n == null || Number.isNaN(n)) return null;
  return Number(n.toFixed(digits));
}

export function groupBy(rows: SignalRow[], key: keyof SignalRow): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) {
    const raw = row[key];
    const k = raw == null ? 'unknown' : String(raw);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

export function avg(arr: number[]): number | null {
  if (arr.length === 0) return null;
  return Number((arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(4));
}