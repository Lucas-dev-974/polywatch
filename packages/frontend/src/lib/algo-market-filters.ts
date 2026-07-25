import type { AlgoMarketPrice } from '../components/AlgoMarketCard';

// Maximum time in the future to consider a market as "future" (15 minutes)
// Markets starting beyond this window are considered too far out and are filtered out.
export const MAX_FUTURE_WINDOW_MS = 15 * 60 * 1000;

/** Live carousel: enabled selections that are still open on Polymarket. */
export function filterActiveLiveMarkets(prices: AlgoMarketPrice[]): AlgoMarketPrice[] {
  return prices.filter((mp) => mp.enabled && !mp.resolved && !mp.closed);
}

/**
 * Future carousel: upcoming windows returned by `/algo/markets-prices`.
 * The backend already limits the discovery window (~10 min); avoid re-filtering
 * with `startDate <= now`, which hides every market at the exact 5m rollover.
 */
export function filterActiveFutureMarkets(
  prices: AlgoMarketPrice[],
  nowMs: number,
): AlgoMarketPrice[] {
  const futureCutoff = nowMs + MAX_FUTURE_WINDOW_MS;
  return prices.filter((mp) => {
    if (mp.resolved || mp.closed) return false;
    const startMs = mp.startDate ? new Date(mp.startDate).getTime() : null;
    if (startMs == null) return true;
    return startMs <= futureCutoff;
  });
}

export function filterInactiveLiveMarkets(prices: AlgoMarketPrice[]): AlgoMarketPrice[] {
  return prices.filter((mp) => !mp.enabled || mp.resolved || mp.closed);
}

export function findNearestFutureMarket(
  prices: AlgoMarketPrice[],
  nowMs: number,
): { label: string; ms: number } | null {
  let nearest: { label: string; ms: number } | null = null;
  for (const mp of prices) {
    if (!mp.startDate) continue;
    const ms = new Date(mp.startDate).getTime() - nowMs;
    if (ms <= 0) continue;
    const label = [mp.cryptoSymbol, mp.interval].filter(Boolean).join(' ');
    if (!nearest || ms < nearest.ms) {
      nearest = { label, ms };
    }
  }
  return nearest;
}

export function filterPositionsByMode<T extends { mode: string; status: string }>(
  positions: T[],
  status: 'open' | 'closed',
  mode: 'all' | 'sim' | 'real'
): T[] {
  return positions.filter((p) => {
    if (p.status !== status) return false;
    if (mode === 'all') return true;
    return p.mode === mode;
  });
}