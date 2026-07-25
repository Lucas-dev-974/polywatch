import type { FinalizeInput, PlatformFeeParams } from '@polywatch/core';
import { buildFilledFinalizeInput } from './build-finalize-input.js';
import { parseClobAmount } from './clob-amounts.js';

export interface UserWsAuth {
  apiKey: string;
  secret: string;
  passphrase: string;
}

export interface UserTradeEvent {
  event_type: 'trade';
  id?: string;
  taker_order_id?: string;
  asset_id?: string;
  side?: string;
  size?: string;
  price?: string;
  status?: string;
}

export interface UserOrderEvent {
  event_type: 'order';
  id?: string;
  asset_id?: string;
  side?: string;
  price?: string;
  original_size?: string;
  size_matched?: string;
  type?: string;
}

const ACTIONABLE_TRADE_STATUSES = new Set(['MATCHED', 'CONFIRMED']);

const ORDER_UPDATE_PREFERRED_STATUSES = new Set([
  'placing',
  'live_on_clob',
  'partial',
  'failed',
]);

/** Prefer order UPDATE (cumulative size_matched) over trade events for in-flight fills. */
export function shouldPreferOrderUpdateForFill(execStatus: string): boolean {
  return ORDER_UPDATE_PREFERRED_STATUSES.has(execStatus);
}

export function isActionableTradeEvent(event: UserTradeEvent): boolean {
  const status = String(event.status ?? '').toUpperCase();
  if (!ACTIONABLE_TRADE_STATUSES.has(status)) return false;
  const qty = Number(event.size ?? 0);
  const price = Number(event.price ?? 0);
  return qty > 0 && price > 0;
}

export function isOrderCancellation(event: UserOrderEvent): boolean {
  return String(event.type ?? '').toUpperCase() === 'CANCELLATION';
}

export function isActionableOrderUpdate(event: UserOrderEvent): boolean {
  const type = String(event.type ?? '').toUpperCase();
  if (type !== 'UPDATE' && type !== 'PLACEMENT') return false;
  const matched = parseClobAmount(event.size_matched);
  return matched > 0;
}

export { parseClobAmount } from './clob-amounts.js';

export function resolveClobOrderIdFromTrade(event: UserTradeEvent): string {
  return String(event.taker_order_id ?? event.id ?? '');
}

export function resolveClobOrderIdFromOrder(event: UserOrderEvent): string {
  return String(event.id ?? '');
}

export function tradeEventToFinalizeInput(
  event: UserTradeEvent,
  orderSignalId: string,
  platformFeeParams: PlatformFeeParams,
): FinalizeInput {
  return buildFilledFinalizeInput(
    orderSignalId,
    Number(event.size),
    Number(event.price),
    platformFeeParams,
    resolveClobOrderIdFromTrade(event),
  );
}

export function orderEventToFinalizeInput(
  event: UserOrderEvent,
  orderSignalId: string,
  platformFeeParams: PlatformFeeParams,
  alreadyFilledQuantity = 0,
): FinalizeInput | null {
  const cumulativeQty = parseClobAmount(event.size_matched);
  const fillQuantity = cumulativeQty - alreadyFilledQuantity;
  if (fillQuantity <= 0) return null;
  const fillPrice = Number(event.price ?? 0);
  if (!(fillPrice > 0)) return null;
  return buildFilledFinalizeInput(
    orderSignalId,
    fillQuantity,
    fillPrice,
    platformFeeParams,
    resolveClobOrderIdFromOrder(event),
  );
}

export function orderCancellationToFinalizeInput(
  orderSignalId: string,
  clobOrderId: string,
): FinalizeInput {
  return {
    orderSignalId,
    status: 'cancelled',
    fillPrice: 0,
    fillQuantity: 0,
    fees: 0,
    clobOrderId,
    error: 'clob_order_cancelled',
  };
}
