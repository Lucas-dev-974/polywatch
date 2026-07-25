import { sleep } from '@polywatch/core';
import type { PolymarketConnectionManager } from './connection-manager.js';
import {
  ALGO_BOOK_FRESH_MS,
  isBilateralBook,
  isFreshBook,
} from './book-freshness.js';
import { sleepUnlessAborted } from '../helpers/sleep-unless-aborted.js';

export { ALGO_BOOK_FRESH_MS };

const RETRY_DELAYS_MS = [500, 1000, 2000] as const;

function hasReadyBook(
  connectionManager: PolymarketConnectionManager,
  assetId: string,
  nowMs: number,
): boolean {
  const book = connectionManager.getOrderBook(assetId);
  return isBilateralBook(book) && isFreshBook(book, nowMs);
}

function isAborted(abortSignal?: AbortSignal): boolean {
  return abortSignal?.aborted ?? false;
}

/**
 * Ensure a bilateral CLOB book is available before an ALGO_OPEN execution.
 * Subscribes WS immediately, then retries REST fetch (handles transient 404 on new 5m tokens).
 * Returns false early when `abortSignal` is aborted.
 */
export async function ensureBookReady(
  connectionManager: PolymarketConnectionManager,
  assetId: string,
  abortSignal?: AbortSignal,
): Promise<boolean> {
  if (isAborted(abortSignal)) {
    return false;
  }

  const nowMs = Date.now();
  if (hasReadyBook(connectionManager, assetId, nowMs)) {
    return true;
  }

  const wsClient = connectionManager.getWsClient();
  await wsClient.subscribe(assetId);

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    if (isAborted(abortSignal)) {
      return false;
    }

    if (hasReadyBook(connectionManager, assetId, Date.now())) {
      return true;
    }

    await connectionManager.fetchBook(assetId, { maxAgeMs: ALGO_BOOK_FRESH_MS });
    if (hasReadyBook(connectionManager, assetId, Date.now())) {
      return true;
    }

    if (attempt < RETRY_DELAYS_MS.length) {
      if (abortSignal) {
        const slept = await sleepUnlessAborted(RETRY_DELAYS_MS[attempt], abortSignal);
        if (!slept || abortSignal.aborted) {
          return false;
        }
      } else {
        await sleep(RETRY_DELAYS_MS[attempt]);
      }
    }
  }

  return false;
}
