import type { MarketListItemDto } from '../polymarket/market-list.js';

/**
 * Live + backtest gate: a weather market is tradable only when open on the
 * CLOB, has a YES token, and is not inside the pre-close window.
 *
 * `nowMs` is injectable so the backtest VirtualClock can evaluate historically.
 */
export function isMarketActiveForWeather(
  market: Pick<MarketListItemDto, 'closed' | 'acceptingOrders' | 'tokenIdYes' | 'endDate'>,
  minHoursToClose: number,
  nowMs: number = Date.now(),
): boolean {
  if (market.closed) return false;
  if (market.acceptingOrders === false) return false;
  if (!market.tokenIdYes) return false;
  if (market.endDate) {
    const end = new Date(market.endDate).getTime();
    if (Number.isNaN(end)) return false;
    const minMs = Math.max(0, minHoursToClose) * 3_600_000;
    if (end - nowMs < minMs) return false;
  }
  return true;
}
