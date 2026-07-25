import { config } from '../config.js';
import { REAL_BALANCE_CACHE_TTL } from '../constants.js';

let realBalanceCache: { amount: number; expiresAt: number } | null = null;

export function invalidateRealBalanceCache(): void {
  realBalanceCache = null;
}

/** Fetch pUSD balance from backend internal route for real mode sizing. */
export async function fetchRealPusdBalance(): Promise<number> {
  if (realBalanceCache && Date.now() < realBalanceCache.expiresAt) {
    return realBalanceCache.amount;
  }
  const url = `${config.backendUrl}/api/internal/balances?mode=real`;
  const res = await fetch(url, {
    headers: { 'x-service-token': config.serviceToken },
  });
  if (!res.ok) {
    throw new Error('real_cash_unavailable');
  }
  const data = (await res.json()) as { amount: number };
  realBalanceCache = {
    amount: data.amount,
    expiresAt: Date.now() + REAL_BALANCE_CACHE_TTL,
  };
  return data.amount;
}
