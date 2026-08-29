import type { OrderSignal } from '@polywatch/core';
import pino from 'pino';
import { fetchRealPusdBalance } from '../sizing/real-balance-cache.js';
import { loadTradingContextResult } from '../clob/trading-context.js';

const log = pino({ name: 'sim-wallet-preflight' });

export type WalletPreflightResult =
  | { ok: true }
  | { ok: false; error: 'insufficient_balance' | 'insufficient_allowance' };

/**
 * Read-only check: would the real wallet cover this BUY collateral amount?
 * Skips silently when credentials are unavailable.
 */
export async function runSimWalletPreflight(
  signal: OrderSignal,
  marketAmountPusd: number,
): Promise<WalletPreflightResult | null> {
  if (signal.side !== 'BUY' || marketAmountPusd <= 0) return null;

  const trading = await loadTradingContextResult();
  if (!trading.ok) {
    log.debug(
      { signalId: signal.id, reason: trading.error },
      'sim wallet preflight skipped — no trading context',
    );
    return null;
  }

  try {
    const balance = await fetchRealPusdBalance();
    if (balance < marketAmountPusd) {
      return { ok: false, error: 'insufficient_balance' };
    }
  } catch (err) {
    log.warn(
      { err, signalId: signal.id },
      'sim wallet preflight skipped — balance fetch failed',
    );
    return null;
  }

  return { ok: true };
}
