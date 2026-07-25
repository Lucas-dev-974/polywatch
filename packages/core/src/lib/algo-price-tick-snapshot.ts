import type { AlgoSurveillancePositionSummary } from '../services/algo-surveillance.types.js';
import type { AlgoPriceTickRecordInput, LiquidityStatus } from './algo-price-tick.types.js';

export type {
  AlgoPriceTickDto,
  AlgoPriceTickMetricsDto,
  AlgoPriceTickRecordInput,
  LiquidityStatus,
} from './algo-price-tick.types.js';

export interface MidPrices {
  up: number | null;
  down: number | null;
}

export interface PositionAggregateMetrics {
  count: number;
  exposureUsd: number;
  unrealizedPnl: number;
}

export interface OutcomeBookView {
  bid: number | null;
  ask: number | null;
  updatedAt: number;
}

export interface OutcomeSideSnapshot {
  book: OutcomeBookView | null;
  bidSize: number | null;
  askSize: number | null;
  askVwap: number | null;
  liquidityStatus: LiquidityStatus | null;
  lastTradePrice: number | null;
  lastTradeSize: number | null;
}

export interface SignalSnapshot {
  outcome: string;
  confidence: number;
  strategyId: string;
  atMs: number;
}

export interface AbstainSnapshot {
  reason: string;
  detail?: string;
  atMs: number;
}

export interface BuildAlgoPriceTickParams {
  conditionId: string;
  upPrice: number | null;
  downPrice: number | null;
  up: OutcomeSideSnapshot;
  down: OutcomeSideSnapshot;
  marketEndMs: number;
  now: number;
  wsHealthy: boolean | null;
  prevMid: MidPrices | null;
  positionMetrics: PositionAggregateMetrics;
  lastSignal: SignalSnapshot | null;
  lastAbstain?: AbstainSnapshot | null;
  recordedAt?: number;
}

export function topBookSize(
  book: { bids: { size: number }[]; asks: { size: number }[] } | undefined,
): { bidSize: number | null; askSize: number | null } {
  if (!book) return { bidSize: null, askSize: null };
  const bidSize = book.bids[0]?.size;
  const askSize = book.asks[0]?.size;
  return {
    bidSize: typeof bidSize === 'number' && bidSize > 0 ? bidSize : null,
    askSize: typeof askSize === 'number' && askSize > 0 ? askSize : null,
  };
}

export function buildAlgoPriceTickRecordInput(
  params: BuildAlgoPriceTickParams,
): AlgoPriceTickRecordInput {
  const { upDelta1s, downDelta1s } = computeDeltas(params.prevMid, {
    up: params.upPrice,
    down: params.downPrice,
  });

  const upBook = params.up.book;
  const downBook = params.down.book;
  const { count, exposureUsd, unrealizedPnl } = params.positionMetrics;

  return {
    conditionId: params.conditionId,
    upPrice: params.upPrice,
    downPrice: params.downPrice,
    recordedAt: params.recordedAt,
    upBid: upBook?.bid ?? null,
    upAsk: upBook?.ask ?? null,
    downBid: downBook?.bid ?? null,
    downAsk: downBook?.ask ?? null,
    upSpreadPct: computeSpreadPercent(upBook?.bid ?? null, upBook?.ask ?? null),
    downSpreadPct: computeSpreadPercent(
      downBook?.bid ?? null,
      downBook?.ask ?? null,
    ),
    upAskVwap: params.up.askVwap,
    downAskVwap: params.down.askVwap,
    upLiquidityStatus: params.up.liquidityStatus,
    downLiquidityStatus: params.down.liquidityStatus,
    priceGap: buildPriceGap(params.upPrice, params.downPrice),
    secondsUntilEnd: computeSecondsUntilEnd(params.marketEndMs, params.now),
    bookStalenessMs: computeStalenessMs(
      upBook?.updatedAt,
      downBook?.updatedAt,
      params.now,
    ),
    wsHealthy: params.wsHealthy,
    upBidSize: params.up.bidSize,
    upAskSize: params.up.askSize,
    downBidSize: params.down.bidSize,
    downAskSize: params.down.askSize,
    upLastTradePrice: params.up.lastTradePrice,
    downLastTradePrice: params.down.lastTradePrice,
    upLastTradeSize: params.up.lastTradeSize,
    downLastTradeSize: params.down.lastTradeSize,
    upDelta1s,
    downDelta1s,
    openPositionsCount: count,
    openExposureUsd: count > 0 ? exposureUsd : null,
    unrealizedPnl: count > 0 ? unrealizedPnl : null,
    lastSignalOutcome: params.lastSignal?.outcome ?? null,
    lastSignalConfidence: params.lastSignal?.confidence ?? null,
    lastSignalStrategyId: params.lastSignal?.strategyId ?? null,
    signalAgeMs: params.lastSignal
      ? params.now - params.lastSignal.atMs
      : null,
    lastAbstainReason: formatAbstainReasonForTick(params.lastAbstain),
  };
}

function formatAbstainReasonForTick(
  abstain: AbstainSnapshot | null | undefined,
): string | null {
  if (!abstain) return null;
  if (!abstain.detail) return abstain.reason;
  const combined = `${abstain.reason}:${abstain.detail}`;
  return combined.length > 120 ? combined.slice(0, 120) : combined;
}

export function parseActiveMarketWindow(
  conditionId: string,
  marketStartAt: string | null | undefined,
  marketEndAt: string | null | undefined,
  now = Date.now(),
): { conditionId: string; marketStartMs: number; marketEndMs: number } | null {
  if (!marketStartAt || !marketEndAt) return null;
  const marketStartMs = Date.parse(marketStartAt);
  const marketEndMs = Date.parse(marketEndAt);
  if (!Number.isFinite(marketStartMs) || !Number.isFinite(marketEndMs)) {
    return null;
  }
  if (now >= marketEndMs) return null;
  return { conditionId, marketStartMs, marketEndMs };
}

export function buildPriceGap(
  up: number | null,
  down: number | null,
): number | null {
  if (up == null && down == null) return null;
  const u = up ?? 0;
  const d = down ?? 0;
  return Math.abs(u + d - 1);
}

export function computeSpreadPercent(
  bid: number | null,
  ask: number | null,
): number | null {
  if (bid == null || ask == null || ask <= 0) return null;
  return ((ask - bid) / ask) * 100;
}

/** Absolute bid/ask spread in probability points (shared with strategy gate). */
export function computeSpreadAbs(
  bid: number | null,
  ask: number | null,
): number | null {
  if (bid == null || ask == null || ask < bid) return null;
  return ask - bid;
}

export function computeStalenessMs(
  upUpdatedAt: number | null | undefined,
  downUpdatedAt: number | null | undefined,
  now: number,
): number | null {
  const times = [upUpdatedAt, downUpdatedAt].filter(
    (t): t is number => t != null && Number.isFinite(t),
  );
  if (times.length === 0) return null;
  return Math.max(...times.map((t) => now - t));
}

export function computeDeltas(
  prev: MidPrices | null,
  curr: MidPrices,
): { upDelta1s: number | null; downDelta1s: number | null } {
  if (!prev) {
    return { upDelta1s: null, downDelta1s: null };
  }
  return {
    upDelta1s:
      prev.up != null && curr.up != null ? curr.up - prev.up : null,
    downDelta1s:
      prev.down != null && curr.down != null ? curr.down - prev.down : null,
  };
}

export function isOpenAlgoPosition(
  pos: AlgoSurveillancePositionSummary,
): boolean {
  return pos.status !== 'closed' && pos.quantity > 0;
}

export function aggregatePositionMetrics(
  positions: AlgoSurveillancePositionSummary[],
): PositionAggregateMetrics {
  let count = 0;
  let exposureUsd = 0;
  let unrealizedPnl = 0;

  for (const pos of positions) {
    if (!isOpenAlgoPosition(pos)) continue;
    count += 1;
    exposureUsd += pos.entryPrice * pos.quantity;
    unrealizedPnl += pos.unrealizedPnl ?? 0;
  }

  return { count, exposureUsd, unrealizedPnl };
}

export function computeSecondsUntilEnd(
  marketEndMs: number,
  now: number,
): number {
  return Math.max(0, Math.floor((marketEndMs - now) / 1000));
}

export function nullableAskVwap(
  vwap: number,
  liquidityStatus: 'ok' | 'partial' | 'illiquid',
): number | null {
  if (liquidityStatus === 'illiquid' || !(vwap > 0)) return null;
  return vwap;
}
