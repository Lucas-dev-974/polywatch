import { getClobApiUrl } from './apis.js';

/** Default Polymarket /prices-history fidelity in minutes (1 point per hour). */
export const DEFAULT_PRICE_HISTORY_FIDELITY = 60;

/** Interval between hourly sync cycles for non-crypto market price history. */
export const MARKET_PRICE_HISTORY_SYNC_INTERVAL_MS = 3_600_000;

export interface PriceHistoryPoint {
  t: number;
  p: number;
}

export interface PriceHistoryQuery {
  assetId: string;
  interval?: '1h' | '6h' | '1d' | '1w' | '1m' | 'max';
  startTs?: number;
  endTs?: number;
  fidelity?: number;
}

/**
 * Fetch historical price data for a Polymarket token from the CLOB API.
 *
 * - `interval` and `startTs`/`endTs` are mutually exclusive (the API rejects combined usage).
 * - `fidelity` controls the resolution in minutes (default 60 = 1 point per hour).
 * - Returns an empty array on any error (network, 4xx, 5xx).
 */
export async function fetchPriceHistory(
  query: PriceHistoryQuery,
): Promise<PriceHistoryPoint[]> {
  const { assetId, interval, startTs, endTs, fidelity } = query;

  if (interval != null && (startTs != null || endTs != null)) {
    throw new Error(
      'fetchPriceHistory: interval and startTs/endTs are mutually exclusive',
    );
  }

  const params = new URLSearchParams({ market: assetId });
  if (interval) params.set('interval', interval);
  if (startTs != null) params.set('startTs', String(startTs));
  if (endTs != null) params.set('endTs', String(endTs));
  if (fidelity != null) params.set('fidelity', String(fidelity));

  const baseUrl = getClobApiUrl();
  const url = `${baseUrl}/prices-history?${params}`;

  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = (await res.json()) as {
      history?: { t: number; p: number }[];
    };
    return Array.isArray(data.history) ? data.history : [];
  } catch {
    return [];
  }
}
