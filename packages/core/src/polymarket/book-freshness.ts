/** Align with crypto-algo `MAX_BOOK_AGE_MS` — books older than this are stale. */
export const ALGO_BOOK_FRESH_MS = 15_000;

export function isFreshBook(
  book: { updatedAt: Date } | undefined,
  nowMs: number,
  maxAgeMs = ALGO_BOOK_FRESH_MS,
): boolean {
  if (!book) return false;
  return nowMs - book.updatedAt.getTime() <= maxAgeMs;
}
