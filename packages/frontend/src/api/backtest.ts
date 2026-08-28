// ─── Backtest API ─────────────────────────────────────────────────────────

import { api, buildQueryString } from './http';

export type BacktestRunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
export type BacktestMode = 'reevaluate';

export interface BacktestRunStrategyDto {
  id: string;
  label: string;
  description: string;
  params: Array<{
    key: string;
    label: string;
    hint?: string;
    display: string;
  }>;
}

export interface BacktestRunDto {
  id: number;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  status: BacktestRunStatus;
  progressPct: number;
  domain: string;
  mode: BacktestMode;
  label: string | null;
  params: Record<string, unknown>;
  dataRangeFrom: string | null;
  dataRangeTo: string | null;
  stats: BacktestStats | null;
  fidelityWarnings: string[] | null;
  engineVersion: string | null;
  error: string | null;
  /** Présent sur GET /runs et /runs/:id — snapshot de la stratégie de la run. */
  strategy?: BacktestRunStrategyDto | null;
}

export interface BacktestStats {
  totalPnl: number;
  pnlPct: number;
  finalEquity: number;
  maxDrawdown: number;
  winRate: number;
  /** null = +Infinity (aucun trade perdant), JSON-safe */
  profitFactor: number | null;
  avgWin: number;
  avgLoss: number;
  expectancy: number;
  totalTrades: number;
  avgHoldingMs: number;
  byExitReason: Record<string, number>;
  byCity: Record<string, number>;
}

export interface BacktestDataCoverage {
  from: string | null;
  to: string | null;
  totalTicks: number;
  cities: string[];
}

export interface BacktestRunParamsInput {
  from: string;
  to: string;
  cities?: string[];
  strategyId?: string;
  strategyEnv?: 'sim' | 'real';
  configOverrides?: Record<string, unknown>;
  capital?: number;
  entryUsdc?: number;
  slippageBps?: number;
  maxConcurrentPositions?: number;
  fidelityMinutes?: number;
  label?: string;
}

export interface BacktestPositionDto {
  id: number;
  runId: number;
  conditionId: string;
  city: string | null;
  side: string;
  qty: number;
  entryPrice: number;
  exitPrice: number | null;
  entryAt: string;
  exitAt: string | null;
  entryReason: string | null;
  exitReason: string | null;
  pnl: number | null;
  fees: number;
}

export interface BacktestEquityPointDto {
  t: string;
  equity: number;
  cash: number;
  openPositions: number;
}

export interface BacktestExcludedTickDto {
  t: string;
  reason: string;
  city: string | null;
  conditionId: string;
  metric: string | null;
}

export interface BacktestMarketSeriesPoint {
  t: string;
  yesPrice: number | null;
}

export interface BacktestMarketSeriesDto {
  conditionId: string;
  city: string | null;
  targetDateIso: string | null;
  metric: string | null;
  bucketComparison: string | null;
  bucketTarget: number | null;
  bucketLow: number | null;
  bucketHigh: number | null;
  unit: 'celsius' | 'fahrenheit' | null;
  forecastMean: number | null;
  forecastStdDev: number | null;
  points: BacktestMarketSeriesPoint[];
}

export interface BacktestListResponse {
  items: BacktestRunDto[];
  total: number;
}

export async function fetchBacktestDataCoverage(
  fidelityMinutes?: number,
): Promise<BacktestDataCoverage> {
  const qs = fidelityMinutes != null && fidelityMinutes > 0
    ? `?fidelityMinutes=${Math.floor(fidelityMinutes)}`
    : '';
  return api<BacktestDataCoverage>(`/backtest/data-coverage${qs}`);
}

export async function launchBacktestRun(data: BacktestRunParamsInput): Promise<{ id: number; status: string }> {
  return api<{ id: number; status: string }>('/backtest/runs', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function fetchBacktestRuns(params: {
  limit?: number;
  offset?: number;
  status?: BacktestRunStatus;
} = {}): Promise<BacktestListResponse> {
  return api<BacktestListResponse>(
    `/backtest/runs${buildQueryString(params)}`,
  );
}

export async function fetchBacktestRun(id: number, signal?: AbortSignal): Promise<BacktestRunDto> {
  return api<BacktestRunDto>(`/backtest/runs/${id}`, signal ? { signal } : undefined);
}

export async function cancelBacktestRun(id: number): Promise<{ id: number; status: string }> {
  return api<{ id: number; status: string }>(`/backtest/runs/${id}/cancel`, {
    method: 'POST',
  });
}

export async function deleteBacktestRun(id: number): Promise<{ id: number; deleted: boolean }> {
  return api<{ id: number; deleted: boolean }>(`/backtest/runs/${id}`, {
    method: 'DELETE',
  });
}

export async function fetchBacktestPositions(
  id: number,
  params: { limit?: number; offset?: number; exitReason?: string; signal?: AbortSignal } = {},
): Promise<{ items: BacktestPositionDto[]; total: number }> {
  const { signal, ...query } = params;
  return api(
    `/backtest/runs/${id}/positions${buildQueryString(query)}`,
    signal ? { signal } : undefined,
  );
}

export async function fetchBacktestEquity(id: number, signal?: AbortSignal): Promise<{ points: BacktestEquityPointDto[] }> {
  return api(`/backtest/runs/${id}/equity`, signal ? { signal } : undefined);
}

export async function fetchBacktestExcludedTicks(
  id: number,
  signal?: AbortSignal,
): Promise<{ ticks: BacktestExcludedTickDto[] }> {
  return api(`/backtest/runs/${id}/excluded-ticks`, signal ? { signal } : undefined);
}

export async function fetchBacktestMarketSeries(
  id: number,
  params: { offset?: number; limit?: number; minAvgYes?: number; signal?: AbortSignal } = {},
): Promise<{ items: BacktestMarketSeriesDto[]; total: number; truncated: boolean }> {
  const { signal, ...query } = params;
  return api(`/backtest/runs/${id}/markets-series${buildQueryString(query)}`, signal ? { signal } : undefined);
}

export interface BacktestLiveMarketSeriesResponse {
  items: BacktestMarketSeriesDto[];
  total: number;
  truncated: boolean;
  window: { from: string | null; to: string | null };
}

export async function fetchLiveMarketSeries(params: {
  fidelityMinutes?: number;
  offset?: number;
  limit?: number;
  minAvgYes?: number;
}): Promise<BacktestLiveMarketSeriesResponse> {
  return api(`/backtest/markets-series${buildQueryString(params)}`);
}
