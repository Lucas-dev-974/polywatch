/** Timeframe values supported by the market chart. */
export const TIMEFRAMES = ['1h', '6h', '1d', '1w', '1m', 'max'] as const;
export type Timeframe = (typeof TIMEFRAMES)[number];

const TIMEFRAME_MS: Record<string, number> = {
  '1h': 3_600_000,
  '6h': 21_600_000,
  '1d': 86_400_000,
  '1w': 604_800_000,
  '1m': 2_592_000_000,
};

/**
 * Compute the `from` Date for a given timeframe string.
 * Returns `null` for `'max'` or unknown values (no time filter).
 */
export function computeTimeframeFrom(timeframe: string): Date | null {
  const ms = TIMEFRAME_MS[timeframe];
  if (!ms) return null;
  return new Date(Date.now() - ms);
}
