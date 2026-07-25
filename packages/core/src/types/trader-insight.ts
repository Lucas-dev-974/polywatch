import type { AnalyticsPnlCategorySlug } from '../simulation/pnl-by-category.js';

export type TraderRegularityLabel = 'very_regular' | 'moderate' | 'sporadic';

export interface TraderInsightProfile {
  userName?: string;
  profileImage?: string;
  xUsername?: string;
  verifiedBadge?: boolean;
  bio?: string;
}

export interface TraderInsightLeaderboardContext {
  rank?: string;
  pnl?: number;
  vol?: number;
}

export interface TraderInsightActivitySummary {
  totalTrades: number;
  totalVolumeUsdc: number;
  firstActivityAt: number | null;
  lastActivityAt: number | null;
  tradingSpanDays: number;
  activeWeeks: number;
  totalWeeks: number;
  avgTradesPerWeek: number;
  avgTradesPerActiveWeek: number;
  longestGapDays: number;
  regularityScore: number;
  regularityLabel: TraderRegularityLabel;
}

export interface TraderInsightTimelinePoint {
  weekStart: string;
  tradeCount: number;
  volumeUsdc: number;
}

export interface TraderCapitalSeriesPoint {
  t: string;
  value: number;
  isLive?: boolean;
}

export interface TraderFundingSummary {
  totalDepositedUsdc: number;
  totalWithdrawnUsdc: number;
  netDepositedUsdc: number;
  depositCount: number;
  withdrawalCount: number;
  firstDepositAt: number | null;
  lastDepositAt: number | null;
}

export interface TraderFundingTimelinePoint {
  t: string;
  cumulativeNetUsdc: number;
}

export interface TraderFundingTransfer {
  id: string;
  timestamp: number;
  direction: 'deposit' | 'withdrawal';
  token: 'USDC.e' | 'USDC' | 'pUSD';
  amountUsdc: number;
  counterparty: string;
  txHash: string;
  explorerUrl: string;
}

export interface TraderFundingAnalysis {
  summary: TraderFundingSummary;
  timeline: TraderFundingTimelinePoint[];
  recentTransfers: TraderFundingTransfer[];
  truncated: boolean;
  addressesAnalyzed: string[];
  coverage: TraderFundingCoverage;
}

export interface TraderFundingCoverage {
  rawTransferCount: number;
  classifiedTransferCount: number;
  fetchesCompleted: number;
  fetchesTotal: number;
  partialFetch: boolean;
}

export type TraderFundingUnavailableReason =
  | 'missing_api_key'
  | 'invalid_api_key'
  | 'rate_limit'
  | 'polygonscan_error';

export interface TraderInsightMarketBreakdownRow {
  slug: AnalyticsPnlCategorySlug;
  label: string;
  tradeCount: number;
  volumeUsdc: number;
  uniqueMarkets: number;
}

export interface TraderInsightOpenPosition {
  conditionId: string;
  title: string;
  outcome: string;
  size: number;
  avgPrice?: number;
  currentValue?: number;
}

export interface TraderInsightRecentActivity {
  id: string;
  timestamp: number;
  title: string;
  side: 'BUY' | 'SELL' | null;
  amount: number | null;
  price: number | null;
  txHash: string | null;
  explorerUrl: string | null;
}

export interface TraderInsightWatchlistContext {
  id: number;
  nickname: string | null;
  simEnabled: boolean;
  realEnabled: boolean;
}

export interface TraderInsightSimStats {
  positionCount: number;
  totalPnl: number;
  winRatePercent: number | null;
  roiPercent: number | null;
}

export interface TraderInsightResponse {
  address: string;
  profile: TraderInsightProfile;
  leaderboard?: TraderInsightLeaderboardContext;
  portfolioValue?: number;
  activitySummary: TraderInsightActivitySummary;
  activityTimeline: TraderInsightTimelinePoint[];
  capitalSeries: TraderCapitalSeriesPoint[];
  marketBreakdown: TraderInsightMarketBreakdownRow[];
  openPositions: TraderInsightOpenPosition[];
  recentActivity: TraderInsightRecentActivity[];
  watchlist: TraderInsightWatchlistContext | null;
  simStats: TraderInsightSimStats | null;
  activityTruncated: boolean;
  funding: TraderFundingAnalysis | null;
  fundingUnavailableReason?: TraderFundingUnavailableReason;
  fetchedAt: string;
}
