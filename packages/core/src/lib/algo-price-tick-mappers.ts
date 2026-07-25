import type { AlgoPriceTick } from '../entities/AlgoPriceTick.js';
import type {
  AlgoChartTickUpdate,
  AlgoPriceTickMetricsDto,
  AlgoPriceTickRecordInput,
} from './algo-price-tick.types.js';

function nullish<T>(value: T | null | undefined): T | null {
  return value ?? null;
}

export function metricFieldsFromInput(
  input: AlgoPriceTickRecordInput,
): Omit<
  AlgoPriceTick,
  'id' | 'conditionId' | 'upPrice' | 'downPrice' | 'recordedAt' | 'createdAt'
> {
  return {
    upBid: nullish(input.upBid),
    upAsk: nullish(input.upAsk),
    downBid: nullish(input.downBid),
    downAsk: nullish(input.downAsk),
    upSpreadPct: nullish(input.upSpreadPct),
    downSpreadPct: nullish(input.downSpreadPct),
    upAskVwap: nullish(input.upAskVwap),
    downAskVwap: nullish(input.downAskVwap),
    upLiquidityStatus: nullish(input.upLiquidityStatus),
    downLiquidityStatus: nullish(input.downLiquidityStatus),
    priceGap: nullish(input.priceGap),
    secondsUntilEnd: nullish(input.secondsUntilEnd),
    bookStalenessMs: nullish(input.bookStalenessMs),
    wsHealthy: nullish(input.wsHealthy),
    upBidSize: nullish(input.upBidSize),
    upAskSize: nullish(input.upAskSize),
    downBidSize: nullish(input.downBidSize),
    downAskSize: nullish(input.downAskSize),
    upLastTradePrice: nullish(input.upLastTradePrice),
    downLastTradePrice: nullish(input.downLastTradePrice),
    upLastTradeSize: nullish(input.upLastTradeSize),
    downLastTradeSize: nullish(input.downLastTradeSize),
    upDelta1s: nullish(input.upDelta1s),
    downDelta1s: nullish(input.downDelta1s),
    openPositionsCount: input.openPositionsCount ?? 0,
    openExposureUsd: nullish(input.openExposureUsd),
    unrealizedPnl: nullish(input.unrealizedPnl),
    lastSignalOutcome: nullish(input.lastSignalOutcome),
    lastSignalConfidence: nullish(input.lastSignalConfidence),
    lastSignalStrategyId: nullish(input.lastSignalStrategyId),
    signalAgeMs: nullish(input.signalAgeMs),
    lastAbstainReason: nullish(input.lastAbstainReason),
  };
}

export function hasEnrichedMetrics(row: AlgoPriceTick): boolean {
  return (
    row.upBid != null ||
    row.upAsk != null ||
    row.downBid != null ||
    row.downAsk != null ||
    row.upSpreadPct != null ||
    row.downSpreadPct != null ||
    row.upAskVwap != null ||
    row.downAskVwap != null ||
    row.upLiquidityStatus != null ||
    row.downLiquidityStatus != null ||
    row.priceGap != null ||
    row.secondsUntilEnd != null ||
    row.bookStalenessMs != null ||
    row.wsHealthy != null ||
    row.upBidSize != null ||
    row.upAskSize != null ||
    row.downBidSize != null ||
    row.downAskSize != null ||
    row.upLastTradePrice != null ||
    row.downLastTradePrice != null ||
    row.upLastTradeSize != null ||
    row.downLastTradeSize != null ||
    row.upDelta1s != null ||
    row.downDelta1s != null ||
    row.openPositionsCount > 0 ||
    row.openExposureUsd != null ||
    row.unrealizedPnl != null ||
    row.lastSignalOutcome != null ||
    row.lastSignalConfidence != null ||
    row.lastSignalStrategyId != null ||
    row.signalAgeMs != null ||
    row.lastAbstainReason != null
  );
}

export function metricsDtoFromInput(
  input: AlgoPriceTickRecordInput,
): AlgoPriceTickMetricsDto | null {
  const fields = metricFieldsFromInput(input);
  const pseudoRow = {
    ...fields,
    id: 0,
    conditionId: input.conditionId,
    upPrice: input.upPrice,
    downPrice: input.downPrice,
    recordedAt:
      input.recordedAt != null ? new Date(input.recordedAt) : new Date(),
    createdAt: new Date(),
  } satisfies AlgoPriceTick;
  return metricsDtoFromEntity(pseudoRow);
}

export function chartTickFromRecordInput(
  input: AlgoPriceTickRecordInput,
  t: number,
): AlgoChartTickUpdate {
  const metrics = metricsDtoFromInput(input);
  return {
    conditionId: input.conditionId,
    t,
    up: input.upPrice,
    down: input.downPrice,
    ...(metrics ? { metrics } : {}),
  };
}

export function metricsDtoFromEntity(
  row: AlgoPriceTick,
): AlgoPriceTickMetricsDto | null {
  if (!hasEnrichedMetrics(row)) return null;
  return {
    upBid: row.upBid,
    upAsk: row.upAsk,
    downBid: row.downBid,
    downAsk: row.downAsk,
    upSpreadPct: row.upSpreadPct,
    downSpreadPct: row.downSpreadPct,
    upAskVwap: row.upAskVwap,
    downAskVwap: row.downAskVwap,
    upLiquidityStatus: row.upLiquidityStatus as AlgoPriceTickMetricsDto['upLiquidityStatus'],
    downLiquidityStatus: row.downLiquidityStatus as AlgoPriceTickMetricsDto['downLiquidityStatus'],
    priceGap: row.priceGap,
    secondsUntilEnd: row.secondsUntilEnd,
    bookStalenessMs: row.bookStalenessMs,
    wsHealthy: row.wsHealthy,
    upBidSize: row.upBidSize,
    upAskSize: row.upAskSize,
    downBidSize: row.downBidSize,
    downAskSize: row.downAskSize,
    upLastTradePrice: row.upLastTradePrice,
    downLastTradePrice: row.downLastTradePrice,
    upLastTradeSize: row.upLastTradeSize,
    downLastTradeSize: row.downLastTradeSize,
    upDelta1s: row.upDelta1s,
    downDelta1s: row.downDelta1s,
    openPositionsCount: row.openPositionsCount,
    openExposureUsd: row.openExposureUsd,
    unrealizedPnl: row.unrealizedPnl,
    lastSignalOutcome: row.lastSignalOutcome,
    lastSignalConfidence: row.lastSignalConfidence,
    lastSignalStrategyId: row.lastSignalStrategyId,
    signalAgeMs: row.signalAgeMs,
    lastAbstainReason: row.lastAbstainReason,
  };
}
