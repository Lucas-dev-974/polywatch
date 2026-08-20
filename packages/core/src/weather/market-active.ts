import type { MarketListItemDto } from '../polymarket/market-list.js';

/**
 * Live + backtest gate: a weather market is tradable only when open on the
 * CLOB and has a YES token. There is no pre-close window — positions are held
 * until resolution (or SL/TP/drift/bucket exit).
 *
 * `nowMs` is retained for interface compatibility but unused.
 */
export function isMarketActiveForWeather(
  market: Pick<MarketListItemDto, 'closed' | 'acceptingOrders' | 'tokenIdYes'>,
  _nowMs?: number,
): boolean {
  if (market.closed) return false;
  if (market.acceptingOrders === false) return false;
  if (!market.tokenIdYes) return false;
  return true;
}
