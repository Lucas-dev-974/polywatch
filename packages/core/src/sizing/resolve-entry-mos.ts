import { fetchBookMinOrderSize } from '../polymarket/api-client.js';
import { MIN_ORDER_SHARES } from './constants.js';
import type { MinOrderSharesDetailed, MinOrderSharesSource } from './entry-mos.js';

export type ClobMarketInfoLookup = (
  conditionId: string,
) => Promise<{ mos?: number } | null | undefined>;

export interface ResolveEntryMinOrderSharesInput {
  conditionId: string;
  assetId: string;
  clobApi: string;
  getClobMarketInfo?: ClobMarketInfoLookup;
}

/**
 * Resolve per-market minimum order size for entry gating (BUY).
 * Does not apply the conservative entry floor — use {@link effectiveEntryMos}.
 */
export async function resolveEntryMinOrderSharesDetailed(
  input: ResolveEntryMinOrderSharesInput,
): Promise<MinOrderSharesDetailed> {
  if (input.getClobMarketInfo && input.conditionId) {
    try {
      const info = await input.getClobMarketInfo(input.conditionId);
      const mos = info?.mos;
      if (typeof mos === 'number' && mos > 0) {
        return { minShares: mos, source: 'clob' };
      }
    } catch {
      // fall through to book REST
    }
  }

  if (input.assetId) {
    try {
      const fromBook = await fetchBookMinOrderSize(input.clobApi, input.assetId);
      if (fromBook != null && fromBook > 0) {
        return { minShares: fromBook, source: 'book' };
      }
    } catch {
      // keep fallback
    }
  }

  const source: MinOrderSharesSource = 'fallback';
  return { minShares: MIN_ORDER_SHARES, source };
}
