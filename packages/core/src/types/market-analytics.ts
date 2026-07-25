import type { TraderCloseReasonBreakdown } from './trader-analytics.js';

export interface MarketOutcomeBreakdown {
  yes: number;
  no: number;
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
  closeReasonBreakdown: TraderCloseReasonBreakdown;
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
  closeReasonBreakdown: TraderCloseReasonBreakdown;
  outcomeBreakdown: MarketOutcomeBreakdown;
}
