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

export interface TraderAnalyticsTotals {
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
  grossWinsTotal: number;
  grossLossesTotal: number;
  profitFactor: number | null;
  avgHoldDurationMs: number | null;
  closeReasonBreakdown: TraderCloseReasonBreakdown;
}
