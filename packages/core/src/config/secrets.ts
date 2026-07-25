/** Known placeholder / example secrets that must never be used in production. */
export const INSECURE_DEFAULT_SECRETS = new Set([
  '0123456789abcdef0123456789abcdef',
  'dev-jwt-secret-change-in-production-32',
  'dev-refresh-secret-change-prod-32',
  'dev-service-token-change-in-prod-32',
  'change-me-jwt-secret-min-32-chars',
  'change-me-refresh-secret-min-32',
  'change-me-service-token-min-32-chars',
]);

const MIN_SECRET_LENGTH = 32;

export function isSecretSecurityBypassed(): boolean {
  const raw = process.env.BYPASS_SECRET_SECURITY?.trim().toLowerCase();
  return raw === 'true' || raw === '1' || raw === 'yes';
}

export function isInsecureSecret(value: string | undefined | null): boolean {
  if (!value || value.length < MIN_SECRET_LENGTH) return true;
  return INSECURE_DEFAULT_SECRETS.has(value);
}

export function assertSecureSecret(
  name: string,
  value: string | undefined,
  nodeEnv: string,
): string {
  if (!value) {
    if (nodeEnv === 'production') {
      throw new Error(`Missing required secret: ${name}`);
    }
    throw new Error(`Missing secret: ${name} (required even in development)`);
  }
  if (isInsecureSecret(value)) {
    if (isSecretSecurityBypassed()) {
      return value;
    }
    if (nodeEnv === 'production') {
      throw new Error(`Insecure default secret for ${name} — generate unique values`);
    }
    console.warn(
      `[security] ${name} uses a known default or short value — real trading is blocked`,
    );
  }
  return value;
}

export interface AppSecrets {
  jwtSecret: string;
  jwtRefreshSecret: string;
  serviceToken: string;
  masterEncryptionKey: string;
}

export function validateProductionSecrets(
  nodeEnv: string,
  secrets: AppSecrets,
): void {
  if (isSecretSecurityBypassed()) {
    console.warn('[security] BYPASS_SECRET_SECURITY enabled — secret validation skipped');
    return;
  }
  if (nodeEnv !== 'production') return;
  assertSecureSecret('JWT_SECRET', secrets.jwtSecret, nodeEnv);
  assertSecureSecret('JWT_REFRESH_SECRET', secrets.jwtRefreshSecret, nodeEnv);
  assertSecureSecret('SERVICE_TOKEN', secrets.serviceToken, nodeEnv);
  assertSecureSecret('MASTER_ENCRYPTION_KEY', secrets.masterEncryptionKey, nodeEnv);
}

/** Real trading requires encryption key and inter-service token to be non-default. */
export function canEnableRealTrading(secrets: Pick<AppSecrets, 'serviceToken' | 'masterEncryptionKey'>): boolean {
  if (isSecretSecurityBypassed()) return true;
  return (
    !isInsecureSecret(secrets.masterEncryptionKey) &&
    !isInsecureSecret(secrets.serviceToken)
  );
}
