import {
  type PlatformFeeParams,
} from '@polywatch/core';
import { buildFilledFinalizeInput } from './build-finalize-input.js';
import { parseClobAmount } from './clob-amounts.js';

export interface ClobTradeLike {
  id: string;
  taker_order_id: string;
  asset_id: string;
  side: string;
  size: string;
  price: string;
  match_time: string;
}

export interface ClobOpenOrderLike {
  id: string;
  size_matched: string;
  price: string;
  status: string;
}

export function pickMatchingTrade(
  trades: ClobTradeLike[],
  assetId: string,
  side: string,
  requestedQty: number,
): ClobTradeLike | null {
  const candidates = trades
    .filter(
      (t) =>
        t.asset_id === assetId &&
        t.side.toUpperCase() === side.toUpperCase() &&
        Math.abs(Number(t.size) - requestedQty) <= Math.max(requestedQty * 0.01, 0.01),
    )
    .sort((a, b) => Number(b.match_time) - Number(a.match_time));
  return candidates[0] ?? null;
}

export function tradeToFinalizeInput(
  trade: ClobTradeLike,
  orderSignalId: string,
  platformFeeParams: PlatformFeeParams,
) {
  return buildFilledFinalizeInput(
    orderSignalId,
    Number(trade.size),
    Number(trade.price),
    platformFeeParams,
    trade.taker_order_id || trade.id,
  );
}

/**
 * Format asymmetry (intentional, see CLOB API):
 * - `getTrades` returns `size`/`price` in human-readable units → Number();
 * - `getOrder` returns `size_matched` in human or raw 6-decimal units → parseClobAmount().
 */
export function openOrderToFinalizeInput(
  order: ClobOpenOrderLike | null | undefined,
  orderSignalId: string,
  platformFeeParams: PlatformFeeParams,
  alreadyFilledQuantity = 0,
): ReturnType<typeof buildFilledFinalizeInput> | null {
  if (!order) return null;
  const cumulativeQty = parseClobAmount(order.size_matched);
  const fillQuantity = cumulativeQty - alreadyFilledQuantity;
  if (fillQuantity <= 0) return null;
  const fillPrice = Number(order.price);
  return buildFilledFinalizeInput(
    orderSignalId,
    fillQuantity,
    fillPrice,
    platformFeeParams,
    order.id,
  );
}
