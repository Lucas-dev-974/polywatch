import type { DataSource } from 'typeorm';
import {
  resolveSlQuotaCacheTtlSeconds,
  resolveSlQuotaEnabled,
  resolveSlQuotaPerMarket,
  type CryptoConfig,
  type TradingMode,
} from '@polywatch/core';

/** Detail for sl_quota_reached abstention observability. */
export type SlQuotaBlockDetail = 'open_position_on_market' | 'sl_slots_consumed';

/**
 * In-memory cache entry for the SL quota state per market and trading mode.
 */
export interface SlQuotaState {
  consumed: number;
  openOnMarket: number;
  fetchedAt: number;
}

const SL_QUOTA_CONSUMED_SQL = `
  SELECT COUNT(*)::int AS cnt FROM copied_positions p
  WHERE p.condition_id = $1
    AND p.mode = $2
    AND p.reason LIKE 'ALGO_%'
    AND (
      p.close_reason = 'SL'
      OR p.closing_reason = 'SL'
      OR (
        p.status = 'closing'
        AND p.closing_reason IS NULL
        AND EXISTS (
          SELECT 1 FROM executions e
          WHERE e.copied_position_id = p.id
            AND e.reason = 'SL'
            AND e.side = 'SELL'
            AND e.status IN ('pending', 'submitted', 'partial')
        )
      )
    )`;

const OPEN_ALGO_ON_MARKET_SQL = `
  SELECT COUNT(*)::int AS cnt FROM copied_positions p
  WHERE p.condition_id = $1
    AND p.mode = $2
    AND p.reason LIKE 'ALGO_%'
    AND p.status IN ('open', 'closing')`;

const globalSlQuotaCache = new Map<string, SlQuotaState>();

/** Cache key scoped per market and trading mode. */
export function buildSlQuotaCacheKey(
  conditionId: string,
  mode: TradingMode,
): string {
  return `${conditionId}:${mode}`;
}

/**
 * Load SL slots consumed for a market and mode (triggered or fully closed SL exits).
 */
export async function loadSlQuotaConsumed(
  ds: DataSource,
  conditionId: string,
  mode: TradingMode,
): Promise<number> {
  const result = await ds.query(SL_QUOTA_CONSUMED_SQL, [conditionId, mode]);
  return result[0]?.cnt ?? 0;
}

/**
 * Load open or in-flight closing algo positions on a market for a single mode.
 */
export async function loadOpenAlgoPositionsOnMarket(
  ds: DataSource,
  conditionId: string,
  mode: TradingMode,
): Promise<number> {
  const result = await ds.query(OPEN_ALGO_ON_MARKET_SQL, [conditionId, mode]);
  return result[0]?.cnt ?? 0;
}

/** @deprecated Use {@link loadSlQuotaConsumed}. */
export async function loadSlQuotaCount(
  ds: DataSource,
  conditionId: string,
  mode: TradingMode,
): Promise<number> {
  return loadSlQuotaConsumed(ds, conditionId, mode);
}

export interface SlQuotaBlockResult {
  blocked: boolean;
  detail?: SlQuotaBlockDetail;
}

/** True when a new entry must be blocked under strict SL quota rules. */
export function shouldBlockSlQuotaEntry(
  consumed: number,
  openOnMarket: number,
  quota: number,
): SlQuotaBlockResult {
  if (openOnMarket > 0) {
    return { blocked: true, detail: 'open_position_on_market' };
  }
  if (consumed >= quota) {
    return { blocked: true, detail: 'sl_slots_consumed' };
  }
  return { blocked: false };
}

/** @deprecated Use {@link shouldBlockSlQuotaEntry}. */
export function isSlQuotaReached(count: number, quota: number): boolean {
  return count >= quota;
}

function slQuotaSkipReason(detail: SlQuotaBlockDetail): string {
  return detail === 'open_position_on_market'
    ? 'Quota SL — position déjà ouverte sur le marché'
    : 'Quota SL atteint';
}

/**
 * Returns a French skip reason when SL quota blocks entry for the given mode,
 * or `null` when entry is allowed.
 */
export async function resolveSlQuotaEntryBlock(params: {
  ds: DataSource;
  conditionId: string;
  mode: TradingMode;
  risk: CryptoConfig;
  nowMs?: number;
  cache?: Map<string, SlQuotaState>;
}): Promise<string | null> {
  const { ds, conditionId, mode, risk } = params;
  if (!resolveSlQuotaEnabled(risk)) {
    return null;
  }

  const quota = resolveSlQuotaPerMarket(risk);
  const cacheTtlMs = resolveSlQuotaCacheTtlSeconds(risk) * 1000;
  const nowMs = params.nowMs ?? Date.now();
  const cache = params.cache ?? globalSlQuotaCache;
  const cacheKey = buildSlQuotaCacheKey(conditionId, mode);

  let slState = cache.get(cacheKey);
  if (!slState || nowMs - slState.fetchedAt >= cacheTtlMs) {
    const [consumed, openOnMarket] = await Promise.all([
      loadSlQuotaConsumed(ds, conditionId, mode),
      loadOpenAlgoPositionsOnMarket(ds, conditionId, mode),
    ]);
    slState = { consumed, openOnMarket, fetchedAt: nowMs };
    cache.set(cacheKey, slState);
  }

  const block = shouldBlockSlQuotaEntry(
    slState.consumed,
    slState.openOnMarket,
    quota,
  );
  if (!block.blocked || !block.detail) {
    return null;
  }
  return slQuotaSkipReason(block.detail);
}

/**
 * Invalidate the cached SL quota for a specific market cache map entry.
 * When `mode` is omitted, both sim and real entries for the market are cleared.
 */
export function invalidateSlQuotaCache(
  map: Map<string, SlQuotaState>,
  conditionId: string,
  mode?: TradingMode,
): void {
  if (mode) {
    map.delete(buildSlQuotaCacheKey(conditionId, mode));
    return;
  }
  map.delete(buildSlQuotaCacheKey(conditionId, 'sim'));
  map.delete(buildSlQuotaCacheKey(conditionId, 'real'));
}

/** Invalidate the process-wide SL quota cache (pub/sub after SL close). */
export function invalidateGlobalSlQuotaCache(
  conditionId: string,
  mode?: TradingMode,
): void {
  invalidateSlQuotaCache(globalSlQuotaCache, conditionId, mode);
}

/**
 * Remove expired entries from the SL quota cache.
 * Returns the number of removed entries.
 */
export function cleanupSlQuotaCache(
  map: Map<string, SlQuotaState>,
  nowMs: number,
  maxAgeMs: number,
): number {
  let removed = 0;
  for (const [key, state] of Array.from(map.entries())) {
    if (nowMs - state.fetchedAt > maxAgeMs) {
      map.delete(key);
      removed++;
    }
  }
  return removed;
}

/** Cleanup helper for the process-wide SL quota cache. */
export function cleanupGlobalSlQuotaCache(nowMs: number, maxAgeMs: number): number {
  return cleanupSlQuotaCache(globalSlQuotaCache, nowMs, maxAgeMs);
}
