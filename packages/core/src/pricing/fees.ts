/** Polymarket platform taker fee parameters (`getClobMarketInfo` → fd.r / fd.e). */
export interface PlatformFeeParams {
  feeRate: number;
  feeExponent: number;
}

export const ZERO_PLATFORM_FEE: PlatformFeeParams = {
  feeRate: 0,
  feeExponent: 1,
};

export function marketPlatformFeeParams(
  market: Pick<PlatformFeeParams, 'feeRate' | 'feeExponent'> | null | undefined,
): PlatformFeeParams {
  if (!market || market.feeRate <= 0) return ZERO_PLATFORM_FEE;
  return {
    feeRate: market.feeRate,
    feeExponent: market.feeExponent > 0 ? market.feeExponent : 1,
  };
}

/**
 * Polymarket platform taker fee (docs + clob-client-v2):
 * fee = C × feeRate × (p × (1 − p))^feeExponent
 * Rounded to 5 decimals; minimum charged fee is 0.00001 USDC.
 */
export function computeTakerFee(
  shares: number,
  price: number,
  params: PlatformFeeParams,
): number {
  const { feeRate, feeExponent } = params;
  if (shares <= 0 || price <= 0 || feeRate <= 0) return 0;

  const curve = price * (1 - price);
  if (curve <= 0) return 0;

  const raw = shares * feeRate * curve ** feeExponent;
  const rounded = Math.round(raw * 100_000) / 100_000;
  return rounded < 0.00001 ? 0 : rounded;
}
