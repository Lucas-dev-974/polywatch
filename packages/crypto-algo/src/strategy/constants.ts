/**
 * Shared constants for crypto-algo strategies.
 */

import {
  DEFAULT_CRYPTO_ALGO_SPREAD_ABS_BY_INTERVAL,
  binaryPricesFromParsed,
} from '@polywatch/core';

/**
 * Valid market intervals for crypto markets.
 */
export const VALID_INTERVALS = ['5m', '10m', '15m', '30m', '1h', '4h', '1d'] as const;
export type ValidInterval = (typeof VALID_INTERVALS)[number];

/**
 * Interval format aliases (e.g., '5min' -> '5m').
 */
export const INTERVAL_ALIASES: Record<string, ValidInterval> = {
  '5min': '5m',
  '10min': '10m',
  '15min': '15m',
  '30min': '30m',
  '1hour': '1h',
  '4hour': '4h',
  '1day': '1d',
};

/**
 * Maximum absolute bid/ask spread (probability points) by interval.
 * Single source: `@polywatch/core` DEFAULT_CRYPTO_ALGO_SPREAD_ABS_BY_INTERVAL (C7.1).
 */
export const SPREAD_ABS_BY_INTERVAL: Record<ValidInterval, number> =
  DEFAULT_CRYPTO_ALGO_SPREAD_ABS_BY_INTERVAL as Record<ValidInterval, number>;

/**
 * @deprecated Prefer {@link SPREAD_ABS_BY_INTERVAL}. Kept for reference / migration.
 * Maximum spread percentage by interval (relative to ask).
 */
export const SPREAD_BY_INTERVAL: Record<ValidInterval, number> = {
  '5m': 10,
  '10m': 8,
  '15m': 7,
  '30m': 6,
  '1h': 5,
  '4h': 5,
  '1d': 5,
};

/**
 * Normalize an interval string to its canonical form.
 * E.g., '5min' -> '5m', '5m' -> '5m'
 */
export function normalizeInterval(interval: string): ValidInterval | null {
  const normalized = INTERVAL_ALIASES[interval] ?? interval;
  return VALID_INTERVALS.includes(normalized as ValidInterval)
    ? (normalized as ValidInterval)
    : null;
}

/**
 * Get maximum allowed absolute spread (probability points) for a given interval.
 * When `spreadByInterval` is provided (from RiskConfig tunables), uses merged table.
 */
export function getMaxSpreadAbsForInterval(
  interval: string | undefined,
  defaultSpreadAbs: number,
  spreadByInterval?: Partial<Record<ValidInterval, number>>,
): number {
  if (!interval) return defaultSpreadAbs;

  const normalized = normalizeInterval(interval);
  if (!normalized) return defaultSpreadAbs;

  if (spreadByInterval && normalized in spreadByInterval) {
    return spreadByInterval[normalized]!;
  }

  return SPREAD_ABS_BY_INTERVAL[normalized];
}

/**
 * @deprecated Prefer {@link getMaxSpreadAbsForInterval}.
 */
export function getMaxSpreadForInterval(
  interval: string | undefined,
  defaultSpread: number,
): number {
  if (!interval) return defaultSpread;

  const normalized = normalizeInterval(interval);
  if (!normalized) return defaultSpread;

  return SPREAD_BY_INTERVAL[normalized];
}

/**
 * Outcome label mappings for YES and NO.
 */
export const YES_LABELS = ['yes', 'up'] as const;
export const NO_LABELS = ['no', 'down'] as const;

/**
 * Find side0/side1 outcomes by label (alias match or index fallback).
 * Returned as yesOutcome/noOutcome for signal YES/NO compatibility.
 */
export function findOutcomes(
  prices: Array<{ outcome: string; price: number }>,
): {
  yesOutcome: { outcome: string; price: number } | null;
  noOutcome: { outcome: string; price: number } | null;
} {
  const { side0, side1 } = binaryPricesFromParsed(prices);
  return {
    yesOutcome: side0,
    noOutcome: side1,
  };
}

/**
 * Validate that outcome prices sum to approximately 1.0.
 */
export function validateOutcomePrices(
  yesPrice: number,
  noPrice: number,
  tolerance: number = 0.02,
): { valid: boolean; sum: number } {
  const sum = yesPrice + noPrice;
  const valid = Math.abs(sum - 1.0) <= tolerance;
  return { valid, sum };
}
