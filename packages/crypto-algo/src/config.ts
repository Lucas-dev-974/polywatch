import {
  getDatabaseUrl,
  loadMonorepoEnv,
} from '@polywatch/core/config/env';

loadMonorepoEnv();

const nodeEnv = process.env.NODE_ENV ?? 'development';

export const config = {
  nodeEnv,
  databaseUrl: getDatabaseUrl(),
  backendUrl: process.env.BACKEND_URL ?? 'http://localhost:3000',
  serviceToken:
    process.env.SERVICE_TOKEN ?? 'dev-service-token-change-in-prod-32',
  gammaApi:
    process.env.POLYMARKET_GAMMA_API ?? 'https://gamma-api.polymarket.com',
  clobApi: process.env.POLYMARKET_CLOB_API ?? 'https://clob.polymarket.com',
  wsUrl:
    process.env.POLYMARKET_WS_URL ??
    'wss://ws-subscriptions-clob.polymarket.com/ws/market',
  pollMs: Number(process.env.CRYPTO_ALGO_POLL_MS ?? 30000),
  priceTickRefQty: Number(process.env.ALGO_PRICE_TICK_REF_QTY ?? '50'),
};