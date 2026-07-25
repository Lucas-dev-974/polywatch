import {
  getDatabaseUrl,
  loadMonorepoEnv,
} from '@polywatch/core/config/env';
import {
  assertSecureSecret,
  validateProductionSecrets,
} from '@polywatch/core/config/secrets';

loadMonorepoEnv();

const nodeEnv = process.env.NODE_ENV ?? 'development';

const secrets = {
  jwtSecret: process.env.JWT_SECRET ?? 'dev-jwt-secret-change-in-production-32',
  jwtRefreshSecret:
    process.env.JWT_REFRESH_SECRET ?? 'dev-refresh-secret-change-prod-32',
  serviceToken:
    process.env.SERVICE_TOKEN ?? 'dev-service-token-change-in-prod-32',
  masterEncryptionKey:
    process.env.MASTER_ENCRYPTION_KEY ?? '0123456789abcdef0123456789abcdef',
};

validateProductionSecrets(nodeEnv, secrets);

const corsOrigins = (
  process.env.CORS_ORIGIN ?? 'http://localhost:5173,http://127.0.0.1:5173'
)
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

export const config = {
  nodeEnv,
  port: Number(process.env.PORT ?? 3000),
  corsOrigins,
  databaseUrl: getDatabaseUrl(),
  jwtSecret: secrets.jwtSecret,
  jwtRefreshSecret: secrets.jwtRefreshSecret,
  serviceToken: secrets.serviceToken,
  masterEncryptionKey: secrets.masterEncryptionKey,
  dataApi: process.env.POLYMARKET_DATA_API ?? 'https://data-api.polymarket.com',
  gammaApi: process.env.POLYMARKET_GAMMA_API ?? 'https://gamma-api.polymarket.com',
  polygonscanApiKey: process.env.POLYGONSCAN_API_KEY?.trim() || undefined,
};
