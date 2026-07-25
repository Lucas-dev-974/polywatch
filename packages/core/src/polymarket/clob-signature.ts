/** Polymarket CLOB V2 — deposit wallet order signature (`POLY_1271`, ERC-1271). */
export const CLOB_SIGNATURE_POLY_1271 = 3;

const VALID_SIGNATURE_TYPES = new Set([
  0,
  1,
  2,
  CLOB_SIGNATURE_POLY_1271,
]);

/**
 * Resolves the CLOB `signatureType` for API trading.
 * Deposit wallets require `3` (`POLY_1271`); defaults to that when unset.
 */
export function resolveClobSignatureType(configured?: number | null): number {
  if (configured != null && VALID_SIGNATURE_TYPES.has(configured)) {
    return configured;
  }
  return CLOB_SIGNATURE_POLY_1271;
}

/** Deposit-wallet trading must use POLY_1271 (signature type 3). */
export function isDepositWalletSignatureType(signatureType: number): boolean {
  return signatureType === CLOB_SIGNATURE_POLY_1271;
}
