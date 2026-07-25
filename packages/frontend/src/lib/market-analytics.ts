import { api } from '../api';
import type { TraderPnlSeriesPoint } from '@polywatch/core/simulation/trader-pnl-series';
import { aggregateMarketAnalyticsTotals as aggregateTotalsCore } from '@polywatch/core/simulation/market-analytics';

export interface MarketOutcomeBreakdown {
  yes: number;
  no: number;
  other: number;
}

export interface MarketCloseReasonBreakdown {
  sl: number;
  tp: number;
  trailing: number;
  preClose: number;
  manual: number;
  copyClose: number;
  redemption: number;
  other: number;
}

export interface MarketAnalyticsRow {
  conditionId: string;
  question: string | null;
  category: string | null;
  tagSlugs: string[];
  marketResolved: boolean;
  marketClosed: boolean;
  traderCount: number;
  positionCount: number;
  openPositionCount: number;
  closedPositionCount: number;
  winningClosedCount: number;
  realizedPnl: number;
  unrealizedPnl: number;
  totalPnl: number;
  investedAmount: number;
  roiPercent: number | null;
  winRatePercent: number | null;
  feesTotal: number;
  bestClosedPnl: number | null;
  worstClosedPnl: number | null;
  grossWinsTotal: number;
  grossLossesTotal: number;
  profitFactor: number | null;
  avgWinPnl: number | null;
  avgLossPnl: number | null;
  avgHoldDurationMs: number | null;
  holdDurationSampleCount: number;
  closeReasonBreakdown: MarketCloseReasonBreakdown;
  outcomeBreakdown: MarketOutcomeBreakdown;
}

export interface MarketAnalyticsTotals {
  marketCount: number;
  positionCount: number;
  openPositionCount: number;
  closedPositionCount: number;
  winningClosedCount: number;
  realizedPnl: number;
  unrealizedPnl: number;
  totalPnl: number;
  investedAmount: number;
  roiPercent: number | null;
  winRatePercent: number | null;
  feesTotal: number;
  grossWinsTotal: number;
  grossLossesTotal: number;
  profitFactor: number | null;
  avgHoldDurationMs: number | null;
  closeReasonBreakdown: MarketCloseReasonBreakdown;
  outcomeBreakdown: MarketOutcomeBreakdown;
}

export interface MarketAnalyticsResponse {
  markets: MarketAnalyticsRow[];
  totals: MarketAnalyticsTotals;
}

export interface MarketPnlSeriesResponse {
  points: TraderPnlSeriesPoint[];
  currentTotalPnl: number;
}

export async function fetchMarketAnalytics(options?: {
  watchlistSimOnly?: boolean;
  watchlistId?: number | null;
}): Promise<MarketAnalyticsResponse> {
  const params = new URLSearchParams();
  if (options?.watchlistSimOnly === false) {
    params.set('watchlistSimOnly', 'false');
  }
  if (options?.watchlistId != null) {
    params.set('watchlistId', String(options.watchlistId));
  }
  const query = params.toString();
  return api<MarketAnalyticsResponse>(
    `/simulation/analytics/market${query ? `?${query}` : ''}`,
  );
}

export async function fetchMarketPnlSeries(
  conditionId: string,
): Promise<MarketPnlSeriesResponse> {
  const params = new URLSearchParams({ conditionId });
  return api<MarketPnlSeriesResponse>(
    `/simulation/analytics/market-pnl-series?${params.toString()}`,
  );
}

export function marketDisplayLabel(row: MarketAnalyticsRow): string {
  if (row.question) return row.question;
  if (row.conditionId.length > 12) {
    return `${row.conditionId.slice(0, 10)}...`;
  }
  return row.conditionId;
}

const CLOSE_REASON_SHORT_LABELS: Record<keyof MarketCloseReasonBreakdown, string> = {
  sl: 'SL',
  tp: 'TP',
  trailing: 'Trail',
  preClose: 'Pré-cl.',
  manual: 'Man.',
  copyClose: 'Copy',
  redemption: 'Réd.',
  other: 'Autre',
};

export function formatCloseReasonBreakdown(
  breakdown: MarketCloseReasonBreakdown,
): string {
  const parts = (Object.keys(CLOSE_REASON_SHORT_LABELS) as (keyof MarketCloseReasonBreakdown)[])
    .filter((key) => breakdown[key] > 0)
    .map((key) => `${CLOSE_REASON_SHORT_LABELS[key]}:${breakdown[key]}`);
  return parts.length > 0 ? parts.join(' · ') : '—';
}

export function formatProfitFactor(
  profitFactor: number | null,
  grossWinsTotal: number,
  grossLossesTotal: number,
): string {
  if (grossLossesTotal === 0 && grossWinsTotal > 0) return '∞';
  if (profitFactor == null) return '—';
  return profitFactor.toFixed(2);
}

export const aggregateMarketAnalyticsTotals = aggregateTotalsCore;
