import type { Market } from '../entities/Market.js';
import type { GammaMarket } from '../polymarket/market-metadata.js';
import { normalizeTokenId } from '../polymarket/redemption.js';

/** Shared lifecycle fields from DB or Gamma/CLOB. */
export type MarketLifecycleState = {
  resolved: boolean;
  winningTokenId: string | null;
  closed: boolean;
  acceptingOrders: boolean | null;
  endDate: Date | null;
};

export function marketLifecycleFromEntity(
  market: Market,
): MarketLifecycleState {
  return {
    resolved: market.resolved,
    winningTokenId: market.winningTokenId,
    closed: market.closed,
    acceptingOrders: market.acceptingOrders,
    endDate: market.endDate,
  };
}

export function marketLifecycleFromGamma(
  market: GammaMarket,
  endDate: Date | null,
): MarketLifecycleState {
  return {
    resolved: market.resolved,
    winningTokenId: market.winningTokenId,
    closed: market.closed,
    acceptingOrders: market.acceptingOrders,
    endDate,
  };
}

/**
 * Market is settled when an outcome is known — equivalent to position-level
 * `redeemable` on Polymarket Data API (market scope).
 */
export function isMarketSettled(market: MarketLifecycleState): boolean {
  if (market.resolved) return true;
  // A market that is closed and no longer accepting orders is terminal
  // regardless of whether a winning token is known (e.g., cancelled events).
  if (market.closed && market.acceptingOrders === false) return true;
  return false;
}

/**
 * Outcome known — the sub-market result is inferred (winning token at 1.00 on CLOB).
 *
 * LEGITIMATE USE: lifecycle flags (`outcomeKnown` in resolveExitLifecycleFlags).
 *
 * DO NOT use for:
 * - suppressing SL/TP → use shouldSuppressSlTp() (resolved or acceptingOrders=false)
 * - deciding pending_resolution → use isMarketRedeemable()
 *   (requires isMarketSettled() && winningTokenId)
 * - displaying "redeeming" in frontend → use getRedemptionWaitPhase()
 *   (requires resolved)
 *
 * winningTokenId is DERIVED from CLOB price (threshold >= 0.99 in
 * market-metadata.ts → determineWinnerFromPrices) and can be known well
 * before the official contract resolution — typically for Polymarket
 * sub-markets (spread, total, exact score) where the sub-token outcome
 * is settled while the main event continues. On UpDown 5m, the losing
 * side may still have executable bids while winningTokenId is already set.
 */
export function isMarketOutcomeKnown(market: MarketLifecycleState): boolean {
  return market.resolved || !!market.winningTokenId;
}

/**
 * Market is closed (endDate past, no longer accepting new orders) but may or
 * may not be resolved. This is a weaker check than {@link isMarketSettled}:
 * a market can be closed without being settled (e.g. `closed=1` yet
 * `acceptingOrders` is still true for a pre-close window).
 */
export function isMarketTerminal(market: MarketLifecycleState): boolean {
  return market.closed && market.acceptingOrders === false;
}

/** Alias aligned with Polymarket Data API naming — only returns true when payout is known. */
export function isMarketRedeemable(market: MarketLifecycleState): boolean {
  return isMarketSettled(market) && !!market.winningTokenId;
}

export function getRedemptionPayoff(
  winningTokenId: string,
  assetId: string,
): 0 | 1 {
  // Token ids may differ in 0x prefix/case depending on the source API —
  // a raw === would silently value a winning position at 0.
  return normalizeTokenId(winningTokenId) === normalizeTokenId(assetId) ? 1 : 0;
}

/**
 * Poll Gamma/CLOB when resolution may be near or the market is past endDate.
 */
export function shouldPollMarketForLifecycle(
  market: Pick<Market, 'resolved' | 'endDate'> | undefined,
  preCloseSeconds = 60,
): boolean {
  if (!market) return true;
  if (market.resolved) return true;
  if (!market.endDate) return true;
  const timeToEndMs = market.endDate.getTime() - Date.now();
  return timeToEndMs <= preCloseSeconds * 1000;
}