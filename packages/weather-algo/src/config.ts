import {
  getDatabaseUrl,
  loadMonorepoEnv,
} from '@polywatch/core/config/env';

loadMonorepoEnv();

const nodeEnv = process.env.NODE_ENV ?? 'development';

export const WEATHER_FORECAST_CACHE_TTL_MS_DEFAULT = 3600_000;
export const POLYMARKET_CLOB_API_DEFAULT = 'https://clob.polymarket.com';

export const config = {
  nodeEnv,
  databaseUrl: getDatabaseUrl(),
  backendUrl: process.env.BACKEND_URL ?? 'http://localhost:3000',
  serviceToken:
    process.env.SERVICE_TOKEN ?? 'dev-service-token-change-in-prod-32',
  gammaApi:
    process.env.POLYMARKET_GAMMA_API ?? 'https://gamma-api.polymarket.com',
  clobApi: process.env.POLYMARKET_CLOB_API ?? POLYMARKET_CLOB_API_DEFAULT,
  wsUrl:
    process.env.POLYMARKET_WS_URL ??
    'wss://ws-subscriptions-clob.polymarket.com/ws/market',
  pollMs: Number(process.env.WEATHER_ALGO_POLL_MS ?? 1800000),
  forecastCacheTtlMs: Number(
    process.env.WEATHER_FORECAST_CACHE_TTL_MS ?? WEATHER_FORECAST_CACHE_TTL_MS_DEFAULT,
  ),
};

/** Resolved CLOB API URL (env or default). */
export const resolvedClobApi = config.clobApi;