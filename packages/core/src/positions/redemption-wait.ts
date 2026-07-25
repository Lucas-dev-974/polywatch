import {
  isMarketTerminal,
  isMarketSettled,
  isMarketOutcomeKnown,
  type MarketLifecycleState,
} from '../market/lifecycle.js';

// INVARIANT — winningTokenId ≠ settled
//
// winningTokenId is DERIVED from the CLOB price (threshold >= 0.99 in
// market-metadata.ts → determineWinnerFromPrices) and persisted in the DB
// (market.service.ts → persistMarket) WITHOUT requiring resolved === true.
//
// For Polymarket sub-markets (spread, total, exact score…), the sub-token
// outcome can be known (token at 1.00) well before the official contract
// resolution — sometimes days ahead (e.g. multi-day tennis, spread hit
// mid-match).
//
// RULE: no lifecycle decision (SL/TP suppression, redemption-awaiting status,
// frontend "redeeming" badge) must rely on winningTokenId alone. Always
// require resolved || isMarketSettled().
//
// Exception: isMarketOutcomeKnown() (lifecycle.ts) is used for outcomeKnown
// lifecycle flags only — NOT for TIME_EXIT skip (see position-exit-evaluator:
// TIME_EXIT skips on resolved === true only). DO NOT reuse isMarketOutcomeKnown
// for SL/TP suppression or redemption lifecycle decisions.

const REDEMPTION_WAIT_POSITION_STATUSES = new Set([
  'open',
  'closing',
  'failed',
  'pending_resolution',
]);

export type RedemptionWaitPhase = 'awaiting_resolution' | 'awaiting_redemption';

export interface ExitLifecycleFlags {
  suppressSlTp: boolean;
  marketSettled: boolean;
  outcomeKnown: boolean;
}

/**
 * Resolve lifecycle flags for exit decisions from a market lifecycle state.
 * Groups suppressSlTp, marketSettled, and outcomeKnown into a single object
 * to avoid redundant lifecycle checks across the exit pipeline.
 */
export function resolveExitLifecycleFlags(
  lifecycle: MarketLifecycleState | null | undefined,
  now = Date.now(),
): ExitLifecycleFlags {
  if (!lifecycle) {
    return { suppressSlTp: false, marketSettled: false, outcomeKnown: false };
  }
  return {
    suppressSlTp: shouldSuppressSlTp(lifecycle, now),
    marketSettled: isMarketSettled(lifecycle),
    outcomeKnown: isMarketOutcomeKnown(lifecycle),
  };
}

export function isRedemptionFailureError(
  error: string | null | undefined,
): boolean {
  if (!error) return false;
  return error.trim().startsWith('redemption_failed');
}

/**
 * Market no longer supports CLOB exit — resolution/redemption path only.
 * Polymarket often keeps acceptingOrders=true briefly after endDate, so we
 * also treat a past endDate as awaiting redemption.
 *
 * NOTE: winningTokenId alone does NOT mean the market is settled — for
 * Polymarket sub-markets (spread, total, exact score) the outcome of the
 * sub-token can be known (price at 1.00) well before the official contract
 * resolution. Only resolved / terminal / past-endDate markets enter the
 * redemption path.
 */
export function isMarketAwaitingRedemptionExit(
  market: MarketLifecycleState | null | undefined,
  now = Date.now(),
): boolean {
  if (!market) return false;
  if (isMarketTerminal(market)) return true;
  if (market.resolved) return true;
  if (market.endDate && market.endDate.getTime() <= now) return true;
  return false;
}

/**
 * Whether SL/TP/trailing evaluation should be suppressed for a position.
 *
 * Suppress when:
 * 1. The market is officially resolved — no CLOB exit possible.
 * 2. The CLOB is not accepting orders (`acceptingOrders === false`) — orders
 *    cannot be placed regardless of endDate (e.g. suspended/postponed match
 *    with a future endDate). Retries would loop indefinitely with
 *    `no_liquidity` errors.
 *
 * A market past endDate but still accepting orders keeps SL/TP active — the
 * CLOB may still have exploitable liquidity (Polymarket sometimes keeps
 * acceptingOrders=true briefly after endDate).
 *
 * winningTokenId alone does NOT suppress — for Polymarket sub-markets (spread,
 * total, exact score) the outcome of the sub-token can be known (price at 1.00)
 * well before the official contract resolution. The CLOB may still have
 * exploitable liquidity.
 */
export function shouldSuppressSlTp(
  market: MarketLifecycleState | null | undefined,
  _now = Date.now(),
): boolean {
  if (!market) return false;
  if (market.resolved) return true;
  // CLOB closed to new orders — cannot exit via market sell regardless of endDate.
  if (market.acceptingOrders === false) {
    return true;
  }
  return false;
}

/**
 * Position waiting for market resolution and/or on-chain redemption — not
 * closable via CLOB. Excludes positions whose latest exit error is a failed
 * redemption attempt (those belong in the actionable-failure bucket).
 */
export function isAwaitingRedemptionPosition(
  pos: { status: string },
  market: MarketLifecycleState | null | undefined,
  lastCloseError: string | null | undefined,
  now = Date.now(),
): boolean {
  if (!REDEMPTION_WAIT_POSITION_STATUSES.has(pos.status)) return false;
  if (isRedemptionFailureError(lastCloseError)) return false;
  if (pos.status === 'pending_resolution') return true;
  return isMarketAwaitingRedemptionExit(market, now);
}

/** Failed exit that still needs user attention (retry close or redemption). */
export function isActionableFailurePosition(
  pos: { status: string },
  market: MarketLifecycleState | null | undefined,
  lastCloseError: string | null | undefined,
  now = Date.now(),
): boolean {
  if (isRedemptionFailureError(lastCloseError)) {
    return pos.status === 'failed' || pos.status === 'pending_resolution';
  }
  if (pos.status !== 'failed') return false;
  return !isAwaitingRedemptionPosition(pos, market, lastCloseError, now);
}

export function getRedemptionWaitPhase(
  pos: { status: string },
  market: MarketLifecycleState | null | undefined,
  lastCloseError: string | null | undefined,
  now = Date.now(),
): RedemptionWaitPhase | null {
  if (!isAwaitingRedemptionPosition(pos, market, lastCloseError, now)) {
    return null;
  }
  if (pos.status === 'pending_resolution') return 'awaiting_redemption';
  if (market?.resolved) return 'awaiting_redemption';
  return 'awaiting_resolution';
}
