import { requiresTraderPortfolioValue } from '@polywatch/core';
import { fetchTraderPortfolioValue } from '../polymarket/api-client.js';

export type TraderPortfolioResult =
  | { ok: true; value: number }
  | { ok: false; reason: 'not_required' }
  | { ok: false; reason: 'zero' }
  | { ok: false; reason: 'fetch_failed'; error: unknown };

export async function resolveTraderPortfolioValue(
  traderAddress: string,
  sizingMode: string,
): Promise<TraderPortfolioResult> {
  if (!requiresTraderPortfolioValue(sizingMode)) {
    return { ok: false, reason: 'not_required' };
  }

  try {
    const value = await fetchTraderPortfolioValue(traderAddress);
    if (value <= 0) {
      return { ok: false, reason: 'zero' };
    }
    return { ok: true, value };
  } catch (error) {
    return { ok: false, reason: 'fetch_failed', error };
  }
}
