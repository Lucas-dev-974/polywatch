import type { TickSize } from '@polymarket/clob-client-v2';
import { TICK_SIZE_CACHE_TTL } from '../constants.js';

// TTL-based tick size cache with LRU eviction at capacity (OPT-11)
const TICK_SIZE_CACHE_MAX = 100;
const tickSizeCache = new Map<string, { tickSize: TickSize; expiresAt: number }>();

/** Shared by live (authenticated client) and sim (public REST) paths. */
export async function resolveTickSizeCached(
  tokenID: string,
  clobClient: { getTickSize(tokenID: string): Promise<TickSize> },
): Promise<TickSize> {
  const cached = tickSizeCache.get(tokenID);
  if (cached && Date.now() < cached.expiresAt) {
    // LRU bump: re-insert to keep recently used entries
    tickSizeCache.delete(tokenID);
    tickSizeCache.set(tokenID, cached);
    return cached.tickSize;
  }
  const ts = await clobClient.getTickSize(tokenID);
  tickSizeCache.set(tokenID, { tickSize: ts, expiresAt: Date.now() + TICK_SIZE_CACHE_TTL });
  // LRU eviction at capacity
  if (tickSizeCache.size > TICK_SIZE_CACHE_MAX) {
    const oldest = tickSizeCache.keys().next().value;
    if (oldest !== undefined) tickSizeCache.delete(oldest);
  }
  return ts;
}

/**
 * Round to the nearest tick without float artifacts: `Math.round(v/t)*t`
 * alone can yield 0.56000000000000005, which the CLOB rejects. Re-quantize
 * to the tick's decimal precision.
 */
export function roundToTick(value: number, tickSize: string): number {
  const tick = Number(tickSize);
  if (!Number.isFinite(tick) || tick <= 0) return value;
  const decimals = (tickSize.split('.')[1] ?? '').length;
  return Number((Math.round(value / tick) * tick).toFixed(decimals));
}
