/**
 * Configuration interface for Polymarket connection components.
 * Allows core package to create connection managers without hardcoding worker config.
 */
export interface PolymarketConnectionConfig {
  /** WebSocket URL for market order book stream */
  wsUrl: string;
  /** CLOB API base URL for REST order book fetches */
  clobApi: string;
}

/**
 * Default Polymarket endpoints.
 */
export const DEFAULT_POLYMARKET_WS_URL = 'wss://ws-subscriptions-clob.polymarket.com/ws/market';
export const DEFAULT_POLYMARKET_CLOB_API = 'https://clob.polymarket.com';