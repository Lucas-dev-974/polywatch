/** Align with crypto-algo `MAX_BOOK_AGE_MS` — books older than this are stale. */
export const ALGO_BOOK_FRESH_MS = 15_000;

export function isBilateralBook(
  book: { bids: unknown[]; asks: unknown[] } | undefined,
): book is { bids: { length: number }[]; asks: { length: number }[] } {
  return Boolean(book && book.bids.length > 0 && book.asks.length > 0);
}

export function isFreshBook(
  book: { updatedAt: Date } | undefined,
  nowMs: number,
  maxAgeMs = ALGO_BOOK_FRESH_MS,
): boolean {
  if (!book) return false;
  return nowMs - book.updatedAt.getTime() <= maxAgeMs;
}

export function bookAgeMs(
  book: { updatedAt: Date } | undefined,
  nowMs: number,
): number | undefined {
  if (!book) return undefined;
  return nowMs - book.updatedAt.getTime();
}
