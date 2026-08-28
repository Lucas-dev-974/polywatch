// ─── Weather Algo data API (onglet Données) + history ingest ──────────────

import type { WeatherMetric } from '@polywatch/core';
import type { WeatherAlgoDataTableId } from '../lib/ui-persistence';
import { api, buildQueryString } from './http';

export interface WeatherAlgoDataTableSummary {
  id: WeatherAlgoDataTableId;
  tableName: string;
  rowCount: number;
  oldestAt: string | null;
  newestAt: string | null;
}

export interface WeatherAlgoDataTablesResponse {
  tables: WeatherAlgoDataTableSummary[];
}

export interface WeatherAlgoDataListResponse<T> {
  items: T[];
  total: number;
}

export interface WeatherAlgoForecastHistoryRow {
  id: number;
  city: string;
  forecastDate: string;
  metric: WeatherMetric;
  forecastMean: number;
  forecastStdDev: number;
  modelValuesJson: string;
  latitude: number;
  longitude: number;
  fetchedAt: string;
}

export interface WeatherAlgoMarketSnapshotRow {
  id: number;
  city: string;
  cityNormalized: string;
  targetDateIso: string;
  metric: WeatherMetric;
  forecastMean: number | null;
  forecastStdDev: number | null;
  bucketCount: number;
  totalBucketCount: number;
  ruleId: number | null;
  recordedAt: string;
  bucketTicks?: unknown[];
}

export interface WeatherAlgoBucketTickRow {
  id: number;
  snapshotId: number;
  city: string | null;
  cityNormalized: string | null;
  targetDateIso: string | null;
  metric: WeatherMetric | null;
  fidelityMinutes: number | null;
  conditionId: string;
  eventSlug: string | null;
  question: string | null;
  bucketComparison: string | null;
  bucketTarget: number | null;
  bucketLow: number | null;
  bucketHigh: number | null;
  yesPrice: number | null;
  noPrice: number | null;
  yesTokenId: string | null;
  noTokenId: string | null;
  volume: number | null;
  volume24hr: number | null;
  liquidityClob: number | null;
  acceptingOrders: boolean | null;
  closed: boolean | null;
  endDate: string | null;
  recordedAt: string;
}

export interface WeatherAlgoEvaluationLogRow {
  id: number;
  snapshotId: number | null;
  conditionId: string;
  strategyId: string;
  mode: 'sim' | 'real';
  yesPrice: number | null;
  forecastProb: number | null;
  edge: number | null;
  dynamicMinEdge: number | null;
  decision: string;
  reason: string | null;
  evaluatedAt: string;
}

export interface WeatherAlgoForecastCacheRow {
  id: number;
  city: string;
  forecastDate: string;
  metric: WeatherMetric;
  forecastMean: number;
  forecastStdDev: number;
  modelValues: string;
  fetchedAt: string;
  expiresAt: string;
}

export interface WeatherAlgoPositionForecastRow {
  id: number;
  copiedPositionId: number;
  city: string;
  targetDate: string;
  metric: WeatherMetric;
  entryForecastMean: number;
  entryForecastStdDev: number;
  entryBucketComparison: string | null;
  openedAt: string | null;
}

export interface WeatherAlgoClobPriceHistoryRow {
  id: number;
  city: string;
  targetDate: string;
  side: 'YES' | 'NO';
  price: number;
  conditionId: string;
  bucketComparison: string | null;
  bucketTarget: number | null;
  bucketLow: number | null;
  bucketHigh: number | null;
  recordedAt: string;
}

export async function fetchWeatherAlgoDataTables(): Promise<WeatherAlgoDataTablesResponse> {
  return api<WeatherAlgoDataTablesResponse>('/weather-algo-data/tables');
}

export async function fetchWeatherAlgoClobPriceHistory(params: {
  city?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}): Promise<WeatherAlgoDataListResponse<WeatherAlgoClobPriceHistoryRow>> {
  return api(
    `/weather-algo-data/clob-price-history${buildQueryString(params)}`,
  );
}

export interface WeatherAlgoDataDeleteAllResponse {
  deleted: Record<WeatherAlgoDataTableId, number>;
  totalDeleted: number;
}

export async function deleteWeatherAlgoDataTables(): Promise<WeatherAlgoDataDeleteAllResponse> {
  return api<WeatherAlgoDataDeleteAllResponse>('/weather-algo-data/tables', {
    method: 'DELETE',
  });
}

export interface WeatherAlgoDataDeleteTableResponse {
  id: WeatherAlgoDataTableId;
  deleted: number;
  cascaded: number;
}

export async function deleteWeatherAlgoDataTable(
  id: WeatherAlgoDataTableId,
): Promise<WeatherAlgoDataDeleteTableResponse> {
  return api<WeatherAlgoDataDeleteTableResponse>(`/weather-algo-data/tables/${id}`, {
    method: 'DELETE',
  });
}

export async function fetchWeatherAlgoForecastHistory(params: {
  city?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}): Promise<WeatherAlgoDataListResponse<WeatherAlgoForecastHistoryRow>> {
  return api(
    `/weather-algo-data/forecast-history${buildQueryString(params)}`,
  );
}

export async function fetchWeatherAlgoMarketSnapshots(params: {
  city?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
  includeTicks?: boolean;
}): Promise<WeatherAlgoDataListResponse<WeatherAlgoMarketSnapshotRow>> {
  return api(
    `/weather-algo-data/market-snapshots${buildQueryString(params)}`,
  );
}

export async function fetchWeatherAlgoBucketTicks(params: {
  city?: string;
  conditionId?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}): Promise<WeatherAlgoDataListResponse<WeatherAlgoBucketTickRow>> {
  return api(`/weather-algo-data/bucket-ticks${buildQueryString(params)}`);
}

export interface BucketTickDateEntry {
  targetDateIso: string;
  cityCount: number;
  tickCount: number;
}

export interface BucketTimelineSeriesPoint {
  recordedAt: string;
  yesPrice: number | null;
}

export interface BucketTimelineBucket {
  conditionId: string;
  bucketComparison: string | null;
  bucketTarget: number | null;
  bucketLow: number | null;
  bucketHigh: number | null;
  unit: 'celsius' | 'fahrenheit' | null;
  series: BucketTimelineSeriesPoint[];
}

export interface BucketTimelineCity {
  cityNormalized: string;
  forecastMean: number | null;
  forecastStdDev: number | null;
  bucketCount: number;
  firstRecordedAt: string;
  lastRecordedAt: string;
  buckets: BucketTimelineBucket[];
}

export interface BucketTimelineDate {
  targetDateIso: string;
  cities: BucketTimelineCity[];
}

export async function fetchBucketTickDates(): Promise<{ dates: BucketTickDateEntry[] }> {
  return api('/weather-algo-data/bucket-ticks/dates');
}

export async function fetchBucketTickTimeline(
  targetDateIso: string,
  params?: {
    city?: string;
    conditionId?: string;
    from?: string;
    to?: string;
    maxTicks?: number;
    fidelityMinutes?: number;
  },
): Promise<{ dates: BucketTimelineDate[] }> {
  const qs = buildQueryString({
    targetDateIso,
    city: params?.city,
    conditionId: params?.conditionId,
    from: params?.from,
    to: params?.to,
    maxTicks: params?.maxTicks,
    fidelityMinutes: params?.fidelityMinutes,
  });
  return api(`/weather-algo-data/bucket-ticks/timeline${qs}`);
}

export async function deleteBucketTickInterval(
  city: string,
  fidelityMinutes: number,
): Promise<{ city: string; fidelityMinutes: number; deleted: number }> {
  const qs = new URLSearchParams({ city, fidelityMinutes: String(fidelityMinutes) });
  return api<{ city: string; fidelityMinutes: number; deleted: number }>(
    `/weather-algo-data/bucket-ticks/interval?${qs}`,
    { method: 'DELETE' },
  );
}

export interface ClobPriceHistoryDateEntry {
  targetDate: string;
  cityCount: number;
  tickCount: number;
}

export interface ClobTimelineSeriesPoint {
  recordedAt: string;
  price: number;
  side: 'YES' | 'NO';
}

export interface ClobTimelineBucket {
  conditionId: string;
  bucketComparison: string | null;
  bucketTarget: number | null;
  bucketLow: number | null;
  bucketHigh: number | null;
  unit: 'celsius' | 'fahrenheit' | null;
  series: ClobTimelineSeriesPoint[];
}

export interface ClobTimelineCity {
  cityNormalized: string;
  bucketCount: number;
  firstRecordedAt: string;
  lastRecordedAt: string;
  buckets: ClobTimelineBucket[];
}

export interface ClobTimelineDate {
  targetDate: string;
  cities: ClobTimelineCity[];
}

export async function fetchClobPriceHistoryDates(): Promise<{
  dates: ClobPriceHistoryDateEntry[];
}> {
  return api('/weather-algo-data/clob-price-history/dates');
}

export async function fetchClobPriceHistoryTimeline(
  targetDate: string,
  params?: { city?: string; maxTicks?: number; fidelityMinutes?: number },
): Promise<{ dates: ClobTimelineDate[] }> {
  const qs = buildQueryString({
    targetDate,
    city: params?.city,
    maxTicks: params?.maxTicks,
    fidelityMinutes: params?.fidelityMinutes,
  });
  return api(`/weather-algo-data/clob-price-history/timeline${qs}`);
}

export async function fetchWeatherAlgoEvaluationLog(params: {
  from?: string;
  to?: string;
  strategyId?: string;
  decision?: string;
  mode?: 'sim' | 'real';
  limit?: number;
  offset?: number;
}): Promise<WeatherAlgoDataListResponse<WeatherAlgoEvaluationLogRow>> {
  return api(`/weather-algo-data/evaluation-log${buildQueryString(params)}`);
}

export async function fetchWeatherAlgoForecastCache(params: {
  city?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}): Promise<WeatherAlgoDataListResponse<WeatherAlgoForecastCacheRow>> {
  return api(`/weather-algo-data/forecast-cache${buildQueryString(params)}`);
}

export async function fetchWeatherAlgoPositionForecasts(params: {
  city?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}): Promise<WeatherAlgoDataListResponse<WeatherAlgoPositionForecastRow>> {
  return api(
    `/weather-algo-data/position-forecasts${buildQueryString(params)}`,
  );
}

// ─── History ingest ────────────────────────────────────────────────────────

export interface WeatherHistoryIngestJob {
  id: number;
  city: string;
  metric: WeatherMetric;
  fromDate: string;
  toDate: string;
  fidelityMinutes: number;
  status: 'pending' | 'running' | 'done' | 'error' | 'cancelled';
  marketsTotal: number;
  marketsDone: number;
  marketsEmpty: number;
  pointsUpserted: number;
  errorMessage: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

export interface WeatherHistoryCoverage {
  city: string;
  pointCount: number;
  fromRecordedAt: string | null;
  toRecordedAt: string | null;
  targetDates: string[];
  intervals: { fidelityMinutes: number; pointCount: number }[];
}

export async function fetchWeatherHistoryCities(): Promise<string[]> {
  const res = await api<{ cities: string[] }>('/weather-algo-history/cities');
  return res.cities;
}

export async function fetchWeatherHistoryCoverage(city: string): Promise<WeatherHistoryCoverage> {
  const qs = new URLSearchParams({ city });
  return api<WeatherHistoryCoverage>(`/weather-algo-history/coverage?${qs}`);
}

export async function fetchWeatherHistoryJob(jobId: number): Promise<WeatherHistoryIngestJob> {
  return api<WeatherHistoryIngestJob>(`/weather-algo-history/jobs/${jobId}`);
}

export async function startWeatherHistoryIngest(input: {
  city: string;
  from: string;
  to: string;
  fidelityMinutes: number;
  metric?: WeatherMetric;
}): Promise<{ jobId: number; job: WeatherHistoryIngestJob }> {
  return api<{ jobId: number; job: WeatherHistoryIngestJob }>('/weather-algo-history/ingest', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function deleteWeatherHistoryInterval(
  city: string,
  fidelityMinutes: number,
): Promise<{ city: string; fidelityMinutes: number; deleted: number }> {
  const qs = new URLSearchParams({ city, fidelityMinutes: String(fidelityMinutes) });
  return api<{ city: string; fidelityMinutes: number; deleted: number }>(
    `/weather-algo-history/interval?${qs}`,
    { method: 'DELETE' },
  );
}
