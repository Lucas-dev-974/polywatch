export type LiquidityStatus = 'ok' | 'partial' | 'illiquid';

export interface AlgoPriceTickMetricsDto {
  upBid: number | null;
  upAsk: number | null;
  downBid: number | null;
  downAsk: number | null;
  upSpreadPct: number | null;
  downSpreadPct: number | null;
  upAskVwap: number | null;
  downAskVwap: number | null;
  upLiquidityStatus: LiquidityStatus | null;
  downLiquidityStatus: LiquidityStatus | null;
  priceGap: number | null;
  secondsUntilEnd: number | null;
  bookStalenessMs: number | null;
  wsHealthy: boolean | null;
  upBidSize: number | null;
  upAskSize: number | null;
  downBidSize: number | null;
  downAskSize: number | null;
  upLastTradePrice: number | null;
  downLastTradePrice: number | null;
  upLastTradeSize: number | null;
  downLastTradeSize: number | null;
  upDelta1s: number | null;
  downDelta1s: number | null;
  openPositionsCount: number;
  openExposureUsd: number | null;
  unrealizedPnl: number | null;
  lastSignalOutcome: string | null;
  lastSignalConfidence: number | null;
  lastSignalStrategyId: string | null;
  signalAgeMs: number | null;
  lastAbstainReason: string | null;
}

export interface AlgoPriceTickDto {
  conditionId: string;
  upPrice: number | null;
  downPrice: number | null;
  recordedAt: string;
  metrics: AlgoPriceTickMetricsDto | null;
}

export interface AlgoPriceTickRecordInput {
  conditionId: string;
  upPrice: number | null;
  downPrice: number | null;
  recordedAt?: number;
  upBid?: number | null;
  upAsk?: number | null;
  downBid?: number | null;
  downAsk?: number | null;
  upSpreadPct?: number | null;
  downSpreadPct?: number | null;
  upAskVwap?: number | null;
  downAskVwap?: number | null;
  upLiquidityStatus?: LiquidityStatus | null;
  downLiquidityStatus?: LiquidityStatus | null;
  priceGap?: number | null;
  secondsUntilEnd?: number | null;
  bookStalenessMs?: number | null;
  wsHealthy?: boolean | null;
  upBidSize?: number | null;
  upAskSize?: number | null;
  downBidSize?: number | null;
  downAskSize?: number | null;
  upLastTradePrice?: number | null;
  downLastTradePrice?: number | null;
  upLastTradeSize?: number | null;
  downLastTradeSize?: number | null;
  upDelta1s?: number | null;
  downDelta1s?: number | null;
  openPositionsCount?: number;
  openExposureUsd?: number | null;
  unrealizedPnl?: number | null;
  lastSignalOutcome?: string | null;
  lastSignalConfidence?: number | null;
  lastSignalStrategyId?: string | null;
  signalAgeMs?: number | null;
  lastAbstainReason?: string | null;
}

/** Metric fields stored on {@link AlgoPriceTick} beyond core prices. */
export type AlgoPriceTickMetricFields = Omit<
  AlgoPriceTickRecordInput,
  'conditionId' | 'upPrice' | 'downPrice'
>;

/** Live chart point pushed over WebSocket after a crypto algo price tick is recorded. */
export interface AlgoChartTickUpdate {
  conditionId: string;
  t: number;
  up: number | null;
  down: number | null;
  metrics?: AlgoPriceTickMetricsDto;
}
