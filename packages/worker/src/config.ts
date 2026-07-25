import {
  getDatabaseUrl,
  loadMonorepoEnv,
} from '@polywatch/core/config/env';
import { assertSecureSecret } from '@polywatch/core/config/secrets';

loadMonorepoEnv();

const nodeEnv = process.env.NODE_ENV ?? 'development';

const serviceToken =
  process.env.SERVICE_TOKEN ?? 'dev-service-token-change-in-prod-32';

if (nodeEnv === 'production') {
  assertSecureSecret('SERVICE_TOKEN', serviceToken, nodeEnv);
}

const defaultWsMarketUrl =
  'wss://ws-subscriptions-clob.polymarket.com/ws/market';

const wsMarketUrl = process.env.POLYMARKET_WS_URL ?? defaultWsMarketUrl;

function resolveWsUserUrl(marketUrl: string): string {
  if (process.env.POLYMARKET_WS_USER_URL) {
    return process.env.POLYMARKET_WS_USER_URL;
  }
  if (marketUrl.includes('/ws/market')) {
    return marketUrl.replace('/ws/market', '/ws/user');
  }
  return 'wss://ws-subscriptions-clob.polymarket.com/ws/user';
}

export const config = {
  nodeEnv,
  databaseUrl: getDatabaseUrl(),
  backendUrl: process.env.BACKEND_URL ?? 'http://localhost:3000',
  serviceToken,
  dataApi: process.env.POLYMARKET_DATA_API ?? 'https://data-api.polymarket.com',
  clobApi: process.env.POLYMARKET_CLOB_API ?? 'https://clob.polymarket.com',
  wsUrl: wsMarketUrl,
  wsUserUrl: resolveWsUserUrl(wsMarketUrl),
  marketTickRetentionDays:
    Number(process.env.MARKET_TICK_RETENTION_DAYS ?? '30'),
  marketTickThrottleMs:
    Number(process.env.MARKET_TICK_THROTTLE_MS ?? '500'),
  marketTickRefQty:
    Number(process.env.MARKET_TICK_REF_QTY ?? '100'),
  marketPriceTickRetentionDays:
    Number(process.env.MARKET_PRICE_TICK_RETENTION_DAYS ?? '0'),
};
