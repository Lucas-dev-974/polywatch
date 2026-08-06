import { isLastCloseableBidFresh } from '@polywatch/core';

/** Reject residual bestBid when far below last-closeable (E9 mirror on emit). */
export const EMIT_BEST_BID_MIN_RATIO = 0.5;

/**
 * Resolve the best available bid for a close signal.
 *
 * Priority:
 * 1. executableBidVwap (full-size)
 * 2. liveBestBid (WS / live top-of-book)
 * 3. persistedBid
 * 4. fresh lastCloseableBid (when allowed)
 * 5. sized residual bestBid (size > 0), only if not anomalously low vs lastCloseable
 */
export function resolveCloseBid(
  executableBidVwap: number,
  liveBestBid?: number,
  persistedBid?: number | null,
  lastCloseableBidVwap?: number | null,
  lastCloseableBidAt?: Date | null,
  allowStaleLastBid = false,
  /** Top-of-book bid with size > 0 when liveBestBid was absent. */
  sizedBestBid?: number | null,
  /** Max age for last-closeable freshness (CryptoConfig / algo-kind tunable). */
  lastCloseableBidMaxAgeMs?: number,
): number {
  if (executableBidVwap > 0) return executableBidVwap;
  if (liveBestBid != null && liveBestBid > 0) return liveBestBid;
  if (persistedBid != null && persistedBid > 0) return persistedBid;
  if (
    allowStaleLastBid &&
    lastCloseableBidVwap != null &&
    lastCloseableBidVwap > 0 &&
    isLastCloseableBidFresh(lastCloseableBidAt, Date.now(), lastCloseableBidMaxAgeMs)
  ) {
    return lastCloseableBidVwap;
  }
  if (sizedBestBid != null && sizedBestBid > 0) {
    if (
      lastCloseableBidVwap != null &&
      lastCloseableBidVwap > 0 &&
      sizedBestBid < lastCloseableBidVwap * EMIT_BEST_BID_MIN_RATIO
    ) {
      return 0;
    }
    return sizedBestBid;
  }
  return 0;
}
