import { hashStrategyOrderSignalId } from '../idempotence/hash.js';
import type { OrderReason, OrderSignal, TradingMode } from '../types/index.js';

/** Reasons that close the entire copied position (CLOB SELL of all shares). */
export const TOTAL_CLOSE_REASONS = [
  'COPY_CLOSE',
  'SL',
  'TP',
  'TRAILING',
  'PRE_CLOSE_LOSS',
  'PRE_CLOSE_WIN',
  'MANUAL',
  'KILL_SWITCH',
  'WEATHER_FORECAST_CHANGE',
  'WEATHER_BUCKET_EXIT',
] as const satisfies readonly OrderReason[];

export type TotalCloseReason = (typeof TOTAL_CLOSE_REASONS)[number];

export function isTotalCloseSignal(
  signal: Pick<OrderSignal, 'side' | 'reason'>,
): signal is OrderSignal & { reason: TotalCloseReason; side: 'SELL' } {
  return (
    signal.side === 'SELL' &&
    (TOTAL_CLOSE_REASONS as readonly string[]).includes(signal.reason)
  );
}

export interface CloseOrderPosition {
  id: number;
  mode: string;
  conditionId: string;
  assetId: string;
  quantity: number;
  entryPrice: number;
  executableBidVwap: number | null;
  closingAttemptSeq: number;
}

/** Effective retry counter, regardless of whether it was explicitly set. */
export function effectiveCloseRetryAttempt(
  signal: Pick<OrderSignal, 'closeRetryAttempt'>,
): number {
  return signal.closeRetryAttempt ?? 0;
}

/**
 * Build a Polymarket-style market sell (FAK) to close a copied position.
 *
 * `closingAttemptSeq` is always set on the signal so the executor can resume
 * a close after Redis retries (`beginClose` on an already-`closing` position).
 *
 * - Strategy path: omit `closingAttemptSeq` — defaults to `pos.closingAttemptSeq + 1`
 *   (the seq the worker's `beginClose` will assign on first attempt).
 * - Manual API path: pass `closingAttemptSeq` after the backend already called `beginClose`.
 */
export function buildCloseOrderSignal(params: {
  pos: CloseOrderPosition;
  reason: TotalCloseReason;
  bidVwap: number;
  closingAttemptSeq?: number;
  closeRetryAttempt?: number;
  lastTradePrice?: number;
}): OrderSignal {
  const attemptSeq =
    params.closingAttemptSeq ?? params.pos.closingAttemptSeq + 1;
  const mode = params.pos.mode as TradingMode;
  const closeRetryAttempt = effectiveCloseRetryAttempt({
    closeRetryAttempt: params.closeRetryAttempt,
  });

  return {
    id: hashStrategyOrderSignalId({
      copiedPositionId: params.pos.id,
      mode,
      reason: params.reason,
      closingAttemptSeq: attemptSeq,
      closeRetryAttempt,
    }),
    copiedPositionId: params.pos.id,
    conditionId: params.pos.conditionId,
    assetId: params.pos.assetId,
    side: 'SELL',
    quantity: params.pos.quantity,
    orderType: 'FAK',
    referenceVwap: params.bidVwap,
    lastTradePrice: params.lastTradePrice,
    reason: params.reason,
    mode,
    closingAttemptSeq: attemptSeq,
    closeRetryAttempt: closeRetryAttempt > 0 ? closeRetryAttempt : undefined,
  };
}

/**
 * Derive the next SL close retry signal from a failed one.
 * Returns null when no additional bid is available.
 */
export async function buildSlCloseRetrySignal(params: {
  pos: CloseOrderPosition;
  previousAttempt: number;
  reason?: TotalCloseReason;
  lastTradePrice?: number;
  fetchBid: () => Promise<{ executableBidVwap: number }>;
}): Promise<OrderSignal | null> {
  const { executableBidVwap } = await params.fetchBid();
  if (executableBidVwap <= 0) return null;
  return buildCloseOrderSignal({
    pos: params.pos,
    reason: params.reason ?? 'SL',
    bidVwap: executableBidVwap,
    closeRetryAttempt: params.previousAttempt + 1,
    lastTradePrice: params.lastTradePrice,
  });
}
