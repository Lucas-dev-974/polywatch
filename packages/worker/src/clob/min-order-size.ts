import {
  MIN_ORDER_SHARES,
  type MinOrderSharesDetailed,
  resolveEntryMinOrderSharesDetailed,
  type OrderSignal,
} from '@polywatch/core';
import { config } from '../config.js';
import { loadTradingContextResult } from './trading-context.js';
import { TICK_SIZE_CACHE_TTL } from '../constants.js';

const MIN_ORDER_CACHE_MAX = 200;
const cache = new Map<string, { detailed: MinOrderSharesDetailed; expiresAt: number }>();

export type ClobMarketInfoLookup = (
  conditionId: string,
) => Promise<{ mos?: number; negRisk?: boolean; neg_risk?: boolean } | null | undefined>;

export interface ResolveMinOrderSharesInput {
  conditionId: string;
  assetId: string;
  getClobMarketInfo?: ClobMarketInfoLookup;
}

/** Authenticated CLOB lookup for per-market `mos` (real mode). */
export async function loadRealClobMarketInfoLookup(): Promise<
  ClobMarketInfoLookup | undefined
> {
  const trading = await loadTradingContextResult();
  if (!trading.ok) return undefined;
  return (conditionId) => trading.context.clobClient.getClobMarketInfo(conditionId);
}

export async function resolveMinOrderSharesDetailed(
  input: ResolveMinOrderSharesInput,
): Promise<MinOrderSharesDetailed> {
  const cacheKey = input.conditionId || input.assetId;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.detailed;
  }

  const detailed = await resolveEntryMinOrderSharesDetailed({
    conditionId: input.conditionId,
    assetId: input.assetId,
    clobApi: config.clobApi,
    getClobMarketInfo: input.getClobMarketInfo,
  });

  cache.set(cacheKey, {
    detailed,
    expiresAt: Date.now() + TICK_SIZE_CACHE_TTL,
  });
  if (cache.size > MIN_ORDER_CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }

  return detailed;
}

export async function resolveMinOrderSharesForSignal(
  signal: Pick<OrderSignal, 'side' | 'conditionId' | 'assetId'>,
  getClobMarketInfo?: ClobMarketInfoLookup,
): Promise<number> {
  if (signal.side !== 'SELL') return MIN_ORDER_SHARES;
  return resolveMinOrderShares({
    conditionId: signal.conditionId,
    assetId: signal.assetId,
    getClobMarketInfo,
  });
}

/** Returns the market minimum when quantity is below mos, else false. */
export async function minSellQuantityViolation(
  signal: Pick<OrderSignal, 'side' | 'quantity' | 'conditionId' | 'assetId'>,
  getClobMarketInfo?: ClobMarketInfoLookup,
): Promise<number | false> {
  if (signal.side !== 'SELL' || signal.quantity <= 0) return false;
  const minShares = await resolveMinOrderSharesForSignal(signal, getClobMarketInfo);
  return signal.quantity < minShares ? minShares : false;
}

/**
 * Per-market minimum order size in shares (Polymarket `mos` / book `min_order_size`).
 * Falls back to {@link MIN_ORDER_SHARES} when metadata is unavailable.
 */
export async function resolveMinOrderShares(
  input: ResolveMinOrderSharesInput,
): Promise<number> {
  const detailed = await resolveMinOrderSharesDetailed(input);
  return detailed.minShares;
}

export function clearMinOrderSizeCache(): void {
  cache.clear();
}
