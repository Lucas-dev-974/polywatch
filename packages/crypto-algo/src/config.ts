import {
  getDatabaseUrl,
  loadMonorepoEnv,
} from '@polywatch/core/config/env';

loadMonorepoEnv();

const nodeEnv = process.env.NODE_ENV ?? 'development';

const DEV_SERVICE_TOKEN = 'dev-service-token-change-in-prod-32';
const rawServiceToken = process.env.SERVICE_TOKEN ?? DEV_SERVICE_TOKEN;

if (nodeEnv === 'production' && rawServiceToken === DEV_SERVICE_TOKEN) {
  console.error(
    'SERVICE_TOKEN must be set to a non-default value in production (NODE_ENV=production).',
  );
  process.exit(1);
}

export const config = {
  nodeEnv,
  databaseUrl: getDatabaseUrl(),
  backendUrl: process.env.BACKEND_URL ?? 'http://localhost:3000',
  serviceToken: rawServiceToken,
  gammaApi:
    process.env.POLYMARKET_GAMMA_API ?? 'https://gamma-api.polymarket.com',
  clobApi: process.env.POLYMARKET_CLOB_API ?? 'https://clob.polymarket.com',
  wsUrl:
    process.env.POLYMARKET_WS_URL ??
    'wss://ws-subscriptions-clob.polymarket.com/ws/market',
  pollMs: Number(process.env.CRYPTO_ALGO_POLL_MS ?? 30000),
  priceTickRefQty: Number(process.env.ALGO_PRICE_TICK_REF_QTY ?? '50'),
};