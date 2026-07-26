export type LiquidityStatus = 'ok' | 'partial' | 'illiquid';
export type TradingMode = 'sim' | 'real';
export type Outcome = 'Yes' | 'No';
export type MoveEventType = 'OPENED' | 'INCREASED' | 'DECREASED' | 'CLOSED';
export type OrderSide = 'BUY' | 'SELL';
export type OrderType = 'GTC' | 'GTD' | 'FOK' | 'FAK';
export type CopiedPositionStatus =
  | 'pending'
  | 'open'
  | 'closing'
  | 'closed'
  | 'failed'
  | 'pending_resolution'
  | 'cancelled';
export type ExecutionStatus =
  | 'placing'
  | 'live_on_clob'
  | 'filled'
  | 'partial'
  | 'cancelled'
  | 'failed'
  | 'no_payout';
export type SizingMode =
  | 'fixed_ratio'
  | 'fixed_usdc'
  | 'fixed_shares'
  | 'proportional_capital'
  | 'kelly_fractional'
  | 'risk_based';
export type KillSwitchAction = 'block_entries' | 'force_close_all' | 'block_and_notify';

export type OrderReason =
  | 'COPY_OPEN'
  | 'COPY_INCREASE'
  | 'COPY_DECREASE'
  | 'COPY_CLOSE'
  | 'SL'
  | 'TP'
  | 'TRAILING'
  | 'PRE_CLOSE_LOSS'
  | 'PRE_CLOSE_WIN'
  | 'MANUAL'
  | 'KILL_SWITCH'
  | 'REDEMPTION'
  | 'ALGO_OPEN'
  | 'ALGO_INCREASE'
  | 'WEATHER_OPEN'
  | 'WEATHER_FORECAST_CHANGE'
  | 'WEATHER_PRE_CLOSE';

export interface OrderBookLevel {
  price: number;
  size: number;
}

export interface OrderBook {
  assetId: string;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  updatedAt: Date;
}

export interface ExecutablePrice {
  assetId: string;
  quantity: number;
  executableBidVwap: number;
  executableAskVwap: number;
  liquidityStatus: LiquidityStatus;
  bookUpdatedAt: Date;
}

export interface MarketMeta {
  title: string;
  endDate: string;
  negativeRisk: boolean;
}

export interface MoveEventDto {
  id: string;
  traderAddress: string;
  conditionId: string;
  assetId: string;
  outcome: string;
  type: MoveEventType;
  traderSize: number;
  traderAvgPrice: number;
  previousTraderSize: number;
  detectedAt: Date;
  marketMeta: MarketMeta;
}

export interface PositionSnapshot {
  conditionId: string;
  assetId: string;
  size: number;
  avgPrice?: number;
  outcome?: string;
}

export interface OrderSignal {
  id: string;
  copiedPositionId: number;
  reservationId?: number;
  conditionId: string;
  assetId: string;
  side: OrderSide;
  quantity: number;
  usdcAmount?: number;
  orderType: OrderType;
  limitPrice?: number;
  referenceVwap?: number;
  /** Last observed trade price, used to make forced exits executable when the book is stale. */
  lastTradePrice?: number;
  reason: OrderReason;
  mode: TradingMode;
  /**
   * Closing attempt the signal belongs to. Set only when the caller has already
   * transitioned the position to `closing` (manual close from the backend) so the
   * worker can resume that exact attempt instead of starting a new one.
   */
  closingAttemptSeq?: number;
  /** SL close execution retry counter (0 = first attempt). */
  closeRetryAttempt?: number;
}

export interface ExecutionResult {
  orderSignalId: string;
  mode: TradingMode;
  status: 'filled' | 'partial' | 'cancelled' | 'failed' | 'no_payout';
  fillPrice: number;
  fillQuantity: number;
  fees: number;
  /** Bid VWAP at execution time — used for SL/TP entry baseline on BUY fills. */
  entryBidVwap?: number;
  /** VWAP reference captured when the signal was generated — used for slippage reporting. */
  referenceVwap?: number;
  /**
   * Detected slippage percent at guard/execution time. Populated for rejected
   * entries (slippage_exceeded) and for filled/partial executions. NULL when
   * the guard was skipped (no referenceVwap).
   */
  slippagePercent?: number;
  txHash?: string;
  clobOrderId?: string;
  error?: string;
  reason?: string;
  /** SL close retry counter from the originating order signal. */
  closeRetryAttempt?: number;
  executedAt: Date;
}

export interface PnlTick {
  copiedPositionId: number;
  executableBidVwap: number;
  triggerPnlPercent: number;
  closurePnlPercent: number;
  unrealizedPnl: number;
  liquidityStatus: LiquidityStatus;
  bookUpdatedAt: Date;
  bookConnectionHealthy: boolean;
}

/** Live top-of-book and last-trade snapshot for a CLOB asset. */
export interface MarketTick {
  assetId: string;
  conditionId?: string;
  bestBid?: number;
  bestAsk?: number;
  /** Top-of-book spread (bestAsk - bestBid). */
  spreadTop?: number;
  /** VWAP spread for a reference quantity when provided. */
  spreadExecutable?: number;
  lastTradePrice?: number;
  lastTradeSize?: number;
  lastTradeTimestamp?: string;
  updatedAt: string;
}

  /** REST-fetched market context (Gamma + Data API). */
export interface MarketMetricsDto {
  conditionId: string;
  volume?: number;
  volume24hr?: number;
  liquidityClob?: number;
  outcomePrices?: { outcome: string; price: number }[];
  openInterest?: number;
  description?: string | null;
  icon?: string | null;
  fetchedAt: string;
  priceHistory?: { t: number; p: number }[];
  recentTrades?: MarketTradeDto[];
  /** Spot USD price history for the underlying crypto asset (Up/Down markets). */
  cryptoSpotHistory?: { t: number; p: number }[];
}

/** Live outcome-price percent update for browse grid cards (Up/Down). */
export interface MarketPercentUpdate {
  conditionId: string;
  outcomePrices: { outcome: string; price: number }[];
  updatedAt: string;
}

export interface MarketTradeDto {
  timestamp: number;
  price: number;
  size: number;
  side?: string;
}

export const MAX_WATCHLIST_SIZE = 20;
export const RESERVATION_TTL_MS = 180_000;

export type AlgoEventStatus = 'live' | 'awaiting_close' | 'resolved' | 'unresolved';

export interface AlgoEvent {
  source: 'algo';
  id: number;
  conditionId: string;
  question: string;
  cryptoSymbol: string | null;
  interval: string | null;
  slug: string | null;
  marketStartAt: string | null;
  marketEndAt: string | null;
  openUpPrice: number | null;
  openDownPrice: number | null;
  openCapturedAt: string | null;
  closeUpPrice: number | null;
  closeDownPrice: number | null;
  closeCapturedAt: string | null;
  winningOutcome: string | null;
  unresolvedAt: string | null;
  executedSim: boolean;
  executedReal: boolean;
  copySlippage: number | null;
  executionErrorSim: string | null;
  executionErrorReal: string | null;
  status: AlgoEventStatus;
}
