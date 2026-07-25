import {
  CopiedPosition,
  triggerPnlPercent,
  unrealizedPnl,
  closurePnlPercent,
  getPositionMarkPrice,
  isMarketSettled,
  isMarketTerminal,
  marketLifecycleFromEntity,
  type MarketLifecycleState,
} from '@polywatch/core';
import type { PnlTick, LiquidityStatus } from '@polywatch/core';
import type { Market } from '@polywatch/core';

export interface PnlSnapshot {
  trigger: number;
  closure: number;
  unrealizedPnl: number;
  peakClosure: number;
}

export interface StaleTickInput {
  pos: CopiedPosition;
  markPrice: number;
  liquidityStatus: LiquidityStatus;
  bookConnectionHealthy: boolean;
}

/**
 * Pure computation helper — no side effects.
 * Used by both the live book path and the illiquid fallback path.
 */
export function computePnlSnapshot(
  markPrice: number,
  pos: CopiedPosition,
): PnlSnapshot {
  const trigger = triggerPnlPercent(markPrice, pos.entryBidVwap);
  const closure = closurePnlPercent(
    markPrice,
    pos.entryPrice,
    pos.entryFeesRemaining ?? 0,
    pos.entryQuantityRemaining ?? pos.quantity,
  );
  const unrl = unrealizedPnl(
    markPrice,
    pos.entryPrice,
    pos.quantity,
    pos.entryFeesRemaining ?? 0,
  );
  const peakClosure = Math.max(
    pos.peakClosurePnlPercent ?? closure,
    closure,
  );
  return { trigger, closure, unrealizedPnl: unrl, peakClosure };
}

/**
 * Build a stale PnL tick from persisted DB values when the live book is illiquid.
 */
export function buildStaleTick(
  input: StaleTickInput,
): PnlTick {
  const { pos, markPrice, liquidityStatus, bookConnectionHealthy } = input;
  const snap = computePnlSnapshot(markPrice, pos);

  return {
    copiedPositionId: pos.id,
    executableBidVwap: markPrice,
    triggerPnlPercent: snap.trigger,
    closurePnlPercent: snap.closure,
    unrealizedPnl: snap.unrealizedPnl,
    liquidityStatus,
    bookUpdatedAt: new Date(),
    bookConnectionHealthy,
  };
}

/**
 * Resolve an effective bid VWAP for close signals.
 * Prefers the live bid when available; falls back to the last persisted DB
 * bid or the entry price. Returns 0 when no fallback exists.
 */
export function getEffectiveBidVwap(
  pos: CopiedPosition,
  liveBid?: number,
): number {
  if (liveBid != null && liveBid > 0) return liveBid;
  return pos.executableBidVwap ?? pos.entryPrice;
}

/**
 * Mark bid for PnL display when the executable VWAP is zero.
 * Prefers live executable bid, then WS top-of-book, then persisted mark.
 */
export function resolveMarkBidForExit(
  pos: CopiedPosition,
  executableBidVwap: number,
  options: {
    wsBestBid?: number;
    lifecycle?: MarketLifecycleState | null;
  } = {},
): number {
  if (executableBidVwap > 0) return executableBidVwap;
  if (options.wsBestBid != null && options.wsBestBid > 0) {
    return options.wsBestBid;
  }
  return getPositionMarkPrice(pos, 0, options.lifecycle ?? null);
}

/** Whether an open position may still receive a CLOB exit signal. */
export function canStillExitViaClob(
  pos: Pick<CopiedPosition, 'executableBidVwap' | 'lastCloseableBidVwap'>,
  bookPrices: { executableBidVwap: number },
  wsBestBid?: number,
  lastTradePrice?: number,
): boolean {
  return (
    bookPrices.executableBidVwap > 0 ||
    (pos.executableBidVwap != null && pos.executableBidVwap > 0) ||
    (pos.lastCloseableBidVwap != null && pos.lastCloseableBidVwap > 0) ||
    (wsBestBid != null && wsBestBid > 0) ||
    (lastTradePrice != null && lastTradePrice > 0)
  );
}

/** Resolve mark price and settlement state for a position. */
export function resolveMarkState(
  pos: CopiedPosition,
  market: Market | undefined,
) {
  const lifecycle = market ? marketLifecycleFromEntity(market) : null;
  const settled = lifecycle ? isMarketSettled(lifecycle) : false;
  const terminal = lifecycle ? isMarketTerminal(lifecycle) : false;
  return { lifecycle, settled, terminal };
}
