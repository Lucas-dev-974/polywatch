/** Normalize a bid mark for exit-attempt journal persistence (0–1). */
export function normalizeExitAttemptMarkBid(
  value: number | null | undefined,
): number | null {
  if (value == null || !Number.isFinite(value) || value <= 0) return null;
  return value;
}
