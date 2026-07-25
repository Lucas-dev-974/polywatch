export type WinningOutcome = 'YES' | 'NO';

/** Canonical token-id form for comparisons (strip 0x prefix, lowercase). */
export function normalizeTokenId(id: string): string {
  return id.replace(/^0x/i, '').toLowerCase();
}

/**
 * Map a resolved winning token id to YES/NO using market token ids.
 * Returns null when the winning token cannot be matched.
 */
export function resolveWinningOutcome(
  winningTokenId: string,
  tokenIdYes: string | null | undefined,
  tokenIdNo: string | null | undefined,
): WinningOutcome | null {
  const win = normalizeTokenId(winningTokenId);
  if (tokenIdYes && normalizeTokenId(tokenIdYes) === win) return 'YES';
  if (tokenIdNo && normalizeTokenId(tokenIdNo) === win) return 'NO';
  return null;
}
