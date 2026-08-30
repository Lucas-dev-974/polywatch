import type { LiquidityStatus } from '../types/index.js';

/** CLOB floor tick used as a dummy quote on empty books. */
export const CLOB_FLOOR_TICK = 0.001;

/**
 * Max shares per pUSD of notional. $1 at 0.001 = 1000 shares (the empty-book
 * FAK). Genuine 1c books ($1 -> 100 shares) stay under this.
 */
export const MAX_ENTRY_SHARES_PER_PUSD = 200;

export function isAbsurdEntryQty(qty: number, notionalPusd: number): boolean {
  if (!(qty > 0)) return false;
  if (!(notionalPusd > 0)) return true;
  return qty > notionalPusd * MAX_ENTRY_SHARES_PER_PUSD;
}

export function isFloorTickAsk(askVwap: number): boolean {
  return askVwap > 0 && askVwap <= CLOB_FLOOR_TICK + 1e-9;
}

/**
 * Skip / no_liquidity before enqueueing a huge FAK on an empty or floor-tick
 * book. A 1-share probe can look "ok" against a 0.001 stub; implied qty vs
 * notional catches $1 -> 1000 shares.
 */
export function shouldSkipNoLiquidityAsk(params: {
  askVwap: number;
  notionalPusd: number;
  impliedQty?: number;
  askLiquidityStatus?: LiquidityStatus | string | null;
  liquidityStatus?: LiquidityStatus | string | null;
}): boolean {
  const { askVwap, notionalPusd } = params;
  if (!(askVwap > 0)) return true;
  const status = params.askLiquidityStatus ?? params.liquidityStatus;
  if (status === 'illiquid') return true;
  const impliedQty =
    params.impliedQty != null && params.impliedQty > 0
      ? params.impliedQty
      : notionalPusd > 0
        ? notionalPusd / askVwap
        : 0;
  if (isAbsurdEntryQty(impliedQty, notionalPusd)) return true;
  if (isFloorTickAsk(askVwap) && status !== 'ok') return true;
  return false;
}