import { api } from '../api';
import { aggregateTraderAnalyticsTotals as aggregateTotalsCore } from '@polywatch/core/simulation/trader-analytics';
import type {
  TraderMarketOption,
  TraderPnlSeriesPoint,
} from '@polywatch/core/simulation/trader-pnl-series';

export type { TraderAnalyticsTotals } from '@polywatch/core/types/trader-analytics';
export type { TraderMarketOption, TraderPnlSeriesPoint };

export interface TraderCloseReasonBreakdown {
  sl: number;
  tp: number;
  trailing: number;
  preClose: number;
  manual: number;
  copyClose: number;
  redemption: number;
  other: number;
}
export interface TraderAnalyticsRow {
  watchlistId: number | null;
  traderAddress: string;
  nickname: string | null;
  simEnabled: boolean | null;
  inWatchlistSim: boolean;
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
  closeReasonBreakdown: TraderCloseReasonBreakdown;
}

export interface TraderAnalyticsResponse {
  traders: TraderAnalyticsRow[];
  pnlByCategory: MarketCategoryPnlRow[];
}

export interface MarketCategoryPnlRow {
  slug: string;
  label: string;
  pnl: number;
  positionCount: number;
}

export interface TraderPnlSeriesResponse {
  points: TraderPnlSeriesPoint[];
  markets: TraderMarketOption[];
  currentTotalPnl: number;
}
export async function fetchTraderAnalytics(options?: {
  watchlistSimOnly?: boolean;
  watchlistId?: number | null;
}): Promise<TraderAnalyticsResponse> {
  const params = new URLSearchParams();
  if (options?.watchlistSimOnly === false) {
    params.set('watchlistSimOnly', 'false');
  }
  if (options?.watchlistId != null) {
    params.set('watchlistId', String(options.watchlistId));
  }
  const query = params.toString();
  return api<TraderAnalyticsResponse>(
    `/simulation/analytics${query ? `?${query}` : ''}`,
  );
}

export async function fetchTraderPnlSeries(
  watchlistId: number,
  conditionId?: string | null,
): Promise<TraderPnlSeriesResponse> {
  const params = new URLSearchParams({ watchlistId: String(watchlistId) });
  if (conditionId) params.set('conditionId', conditionId);
  return api<TraderPnlSeriesResponse>(
    `/simulation/analytics/trader-pnl-series?${params.toString()}`,
  );
}

export function traderDisplayName(row: TraderAnalyticsRow): string {
  if (row.nickname) return row.nickname;
  if (row.traderAddress.length > 12) {
    return `${row.traderAddress.slice(0, 10)}…`;
  }
  return row.traderAddress || '—';
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

const CLOSE_REASON_SHORT_LABELS: Record<keyof TraderCloseReasonBreakdown, string> = {
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
  breakdown: TraderCloseReasonBreakdown,
): string {
  const parts = (Object.keys(CLOSE_REASON_SHORT_LABELS) as (keyof TraderCloseReasonBreakdown)[])
    .filter((key) => breakdown[key] > 0)
    .map((key) => `${CLOSE_REASON_SHORT_LABELS[key]}:${breakdown[key]}`);
  return parts.length > 0 ? parts.join(' · ') : '—';
}

export const aggregateTraderAnalyticsTotals = aggregateTotalsCore;
