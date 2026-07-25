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

type UnrealizedPnlPosition = Pick<
  CopiedPosition,
  | 'assetId'
  | 'executableBidVwap'
  | 'entryBidVwap'
  | 'entryPrice'
  | 'quantity'
  | 'entryFeesRemaining'
>;

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
    position.entryPrice,
    position.quantity,
    position.entryFeesRemaining ?? 0,
  );
}
