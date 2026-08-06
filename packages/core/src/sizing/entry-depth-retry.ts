import { ALGO_BOOK_FRESH_MS } from '../polymarket/book-freshness.js';
import type { ExecutablePriceResult } from '../worker-shared/connection-manager-interface.js';

export type EntryDepthFetchBookOptions = { maxAgeMs?: number };

export type EntryDepthConnectionManager = {
  fetchExecutablePrices(
    assetId: string,
    quantity: number,
    options?: EntryDepthFetchBookOptions,
  ): Promise<ExecutablePriceResult>;
  forceRefreshBook?(assetId: string): Promise<unknown>;
};

export interface EntryDepthRetryParams {
  assetId: string;
  targetQty: number;
  /** Retries after the first failed depth check (3 = up to 4 attempts total). */
  maxRetries: number;
  delayMs: number;
  connectionManager: EntryDepthConnectionManager;
  /** Reject cached books older than this (default ALGO_BOOK_FRESH_MS). */
  maxBookAgeMs?: number;
}

export type EntryDepthRetryResult =
  | { ok: true; prices: ExecutablePriceResult; attempts: number }
  | { ok: false; skipReason: string; attempts: number };

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** True when the ask book can fully fill `targetQty` at executable prices. */
export function isEntryAskDepthSufficient(
  prices: ExecutablePriceResult,
): boolean {
  const askStatus = prices.askLiquidityStatus ?? prices.liquidityStatus;
  return prices.executableAskVwap > 0 && askStatus === 'ok';
}

/**
 * Poll ask-side depth until the target quantity is fully available, retrying
 * with optional book refresh and delay between attempts.
 */
export async function fetchEntryAskLiquidityWithRetries(
  params: EntryDepthRetryParams,
): Promise<EntryDepthRetryResult> {
  const maxAttempts = Math.max(1, params.maxRetries + 1);
  const maxAgeMs = params.maxBookAgeMs ?? ALGO_BOOK_FRESH_MS;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (attempt > 1) {
      if (params.connectionManager.forceRefreshBook) {
        const refreshed = await params.connectionManager.forceRefreshBook(
          params.assetId,
        );
        // Refresh failed → do not judge depth on a possibly stale cache.
        if (refreshed == null) {
          if (params.delayMs > 0) await sleepMs(params.delayMs);
          continue;
        }
      }
      if (params.delayMs > 0) {
        await sleepMs(params.delayMs);
      }
    }

    const prices = await params.connectionManager.fetchExecutablePrices(
      params.assetId,
      params.targetQty,
      { maxAgeMs },
    );

    if (isEntryAskDepthSufficient(prices)) {
      return { ok: true, prices, attempts: attempt };
    }
  }

  return {
    ok: false,
    skipReason: `Profondeur ask insuffisante pour ${params.targetQty} shares (${maxAttempts} tentative${maxAttempts > 1 ? 's' : ''})`,
    attempts: maxAttempts,
  };
}
