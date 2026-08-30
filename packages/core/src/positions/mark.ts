import type { CopiedPosition } from '../entities/CopiedPosition.js';
import {
  getRedemptionPayoff,
  isMarketSettled,
  isMarketTerminal,
  type MarketLifecycleState,
} from '../market/lifecycle.js';
import { unrealizedPnl } from '../pricing/vwap.js';

/** Statuses that still hold capital and appear in open-P&L aggregates. */
export const OPEN_LIKE_POSITION_STATUSES = [
  'open',
  'closing',
  'pending_resolution',
  'failed',
] as const;

export type OpenLikePositionStatus = (typeof OPEN_LIKE_POSITION_STATUSES)[number];

export function isOpenLikePositionStatus(status: string): boolean {
  return (OPEN_LIKE_POSITION_STATUSES as readonly string[]).includes(status);
}

/** Opening/increase/exit reasons that belong to the weather algo. */
export function isWeatherPositionReason(
  reason: string | null | undefined,
): boolean {
  return typeof reason === 'string' && reason.startsWith('WEATHER_');
}

/**
 * Cost basis used for unrealized dollar PnL.
 *
 * Weather: executable bid vs entryBidVwap so t0 uPnL is fees-only (the
 * taker spread is a realized-cash fact, not an immediate mark loss).
 * Missing/zero entryBidVwap falls back to entryPrice so we never show a
 * fake 0. Copy/crypto keep bid vs entry ask.
 */
export function unrealizedPnlEntryBasis(position: {
  reason?: string | null;
  entryBidVwap?: number | null;
  entryPrice: number;
}): number {
  if (
    isWeatherPositionReason(position.reason) &&
    position.entryBidVwap != null &&
    position.entryBidVwap > 0
  ) {
    return position.entryBidVwap;
  }
  return position.entryPrice;
}


/**
 * Exit-now cash PnL: sell at bid vs entry ask minus remaining fees.
 * Shown separately on weather open rows so close is not a surprise.
 * Live uPnL stays bid vs entry bid (fees-only at t0).
 */
export function computeExecutableCashPnl(position: {
  executableBidVwap?: number | null;
  entryPrice: number;
  quantity: number;
  entryFeesRemaining?: number | null;
}): number | null {
  const bid = position.executableBidVwap;
  if (bid == null || !(bid > 0) || !(position.quantity > 0) || !(position.entryPrice > 0)) {
    return null;
  }
  return unrealizedPnl(
    bid,
    position.entryPrice,
    position.quantity,
    position.entryFeesRemaining ?? 0,
  );
}

type UnrealizedPnlPosition = Pick<
  CopiedPosition,
  | 'assetId'
  | 'executableBidVwap'
  | 'entryBidVwap'
  | 'entryPrice'
  | 'quantity'
  | 'entryFeesRemaining'
> & {
  reason?: string | null;
};

type MarkablePosition = Pick<
  CopiedPosition,
  | 'assetId'
  | 'conditionId'
  | 'executableBidVwap'
  | 'entryBidVwap'
  | 'entryPrice'
  | 'quantity'
>;

/**
 * Mark price for a held position, aligned with Polymarket lifecycle:
 * - settled market → redemption payoff (0 or 1)
 * - live book bid when available
 * - last observed bid, then entry price as fallback (expired/illiquid book)
 */
export function getPositionMarkPrice(
  position: Pick<
    CopiedPosition,
    'assetId' | 'executableBidVwap' | 'entryBidVwap' | 'entryPrice'
  >,
  bookBid: number,
  market?: MarketLifecycleState | null,
): number {
  // Settled with known winner → redemption payoff
  if (market?.winningTokenId && isMarketSettled(market)) {
    return getRedemptionPayoff(market.winningTokenId, position.assetId);
  }

  // Terminal (closed + no orders) but not yet resolved: fall back to book or
  // last known bid as mark price (MF-5)
  if (market && isMarketTerminal(market)) {
    if (bookBid > 0) return bookBid;
    if (position.executableBidVwap && position.executableBidVwap > 0) {
      return position.executableBidVwap;
    }
    return position.entryBidVwap ?? position.entryPrice;
  }

  if (bookBid > 0) return bookBid;
  if (position.executableBidVwap && position.executableBidVwap > 0) {
    return position.executableBidVwap;
  }
  return position.entryBidVwap ?? position.entryPrice;
}

export function sumOpenPositionsValue(
  positions: MarkablePosition[],
  markets?: Map<string, MarketLifecycleState>,
): number {
  return positions.reduce((total, position) => {
    const market = markets?.get(position.conditionId);
    const mark = getPositionMarkPrice(position, 0, market ?? null);
    return total + position.quantity * mark;
  }, 0);
}

/** Mark-to-market unrealized P&L aligned with equity snapshot and hero aggregates. */
export function computePositionUnrealizedPnl(
  position: UnrealizedPnlPosition,
  market?: MarketLifecycleState | null,
  bookBid = 0,
): number {
  const mark = getPositionMarkPrice(position, bookBid, market ?? null);
  return unrealizedPnl(
    mark,
    unrealizedPnlEntryBasis(position),
    position.quantity,
    position.entryFeesRemaining ?? 0,
  );
}
