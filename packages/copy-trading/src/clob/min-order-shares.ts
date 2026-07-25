import {
  resolveEntryMinOrderSharesDetailed,
  type MinOrderSharesDetailed,
} from '@polywatch/core';
import { config } from '../config.js';
import { MIN_ORDER_CACHE_TTL_MS } from '../constants.js';

const cache = new Map<string, { detailed: MinOrderSharesDetailed; expiresAt: number }>();
const MIN_ORDER_CACHE_MAX = 200;

export interface ResolveMinOrderSharesInput {
  conditionId: string;
  assetId: string;
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
  });

  cache.set(cacheKey, {
    detailed,
    expiresAt: Date.now() + MIN_ORDER_CACHE_TTL_MS,
  });
  if (cache.size > MIN_ORDER_CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }

  return detailed;
}

export async function resolveMinOrderShares(
  input: ResolveMinOrderSharesInput,
): Promise<number> {
  const detailed = await resolveMinOrderSharesDetailed(input);
  return detailed.minShares;
}
