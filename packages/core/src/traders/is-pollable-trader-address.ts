/** Ethereum address pattern accepted by Polymarket Data API `user` param. */
const ETHEREUM_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

/**
 * Whether a watchlist `traderAddress` can be polled via Data API `/positions`.
 * Algo sentinel entries (e.g. `crypto-algo`, `weather-algo`) are not wallets.
 */
export function isPollableTraderAddress(address: string): boolean {
  return ETHEREUM_ADDRESS_RE.test(address.trim());
}
