import type { CopyConfig } from '../entities/CopyConfig.js';
import type { CryptoConfig } from '../entities/CryptoConfig.js';
import type { GlobalConfig } from '../entities/GlobalConfig.js';
import type { RiskConfig } from '../entities/RiskConfig.js';
import type { WeatherConfig } from '../entities/WeatherConfig.js';

const GLOBAL_CRITICAL_FIELDS = [
  'realTradingEnabled',
  'maxSlippagePercent',
  'simExecLatencyMode',
  'simAutoSnapshotEnabled',
  'realAutoSnapshotEnabled',
] as const satisfies readonly (keyof GlobalConfig)[];

const COPY_CRITICAL_FIELDS = [
  'simCopyTradingEnabled',
  'realCopyTradingEnabled',
  'simMaxOpenPositions',
  'realMaxOpenPositions',
  'simMaxDailyLossUsdc',
  'realMaxDailyLossUsdc',
  'simKillSwitchAction',
  'realKillSwitchAction',
] as const satisfies readonly (keyof CopyConfig)[];

const CRYPTO_CRITICAL_FIELDS = [
  'cryptoAlgoEnabled',
  'cryptoAlgoReentryWindowMs',
  'cryptoAlgoMaxEntriesPerWindow',
] as const satisfies readonly (keyof CryptoConfig)[];

const WEATHER_CRITICAL_FIELDS = [
  'weatherAlgoEnabled',
  'weatherAlgoSimEnabled',
  'weatherAlgoRealEnabled',
] as const satisfies readonly (keyof WeatherConfig)[];

function collectFieldDivergences(
  composed: RiskConfig,
  source: Record<string, unknown>,
  fields: readonly string[],
): string[] {
  const divergences: string[] = [];
  const composedRecord = composed as unknown as Record<string, unknown>;
  for (const field of fields) {
    if (composedRecord[field] !== source[field]) {
      divergences.push(field);
    }
  }
  return divergences;
}

/** Detect fields where the composed RiskConfig facade diverges from isolated tables. */
export function detectRiskConfigDivergences(
  composed: RiskConfig,
  global: GlobalConfig,
  copy: CopyConfig,
  crypto: CryptoConfig,
  weather: WeatherConfig,
): string[] {
  return [
    ...collectFieldDivergences(composed, global as unknown as Record<string, unknown>, GLOBAL_CRITICAL_FIELDS),
    ...collectFieldDivergences(composed, copy as unknown as Record<string, unknown>, COPY_CRITICAL_FIELDS),
    ...collectFieldDivergences(composed, crypto as unknown as Record<string, unknown>, CRYPTO_CRITICAL_FIELDS),
    ...collectFieldDivergences(composed, weather as unknown as Record<string, unknown>, WEATHER_CRITICAL_FIELDS),
  ];
}

export class RiskConfigDivergenceError extends Error {
  constructor(public readonly divergences: string[]) {
    super(`risk_config_divergence: ${divergences.join(',')}`);
    this.name = 'RiskConfigDivergenceError';
  }
}

/** Default handler: warn in log-only mode, throw when strict. */
export function handleRiskConfigDivergence(
  divergences: string[],
  strict: boolean,
  log: { warn: (obj: unknown, msg: string) => void; error: (obj: unknown, msg: string) => void },
): void {
  if (divergences.length === 0) return;
  if (strict) {
    log.error({ divergences }, 'RiskConfig facade divergence detected — blocking');
    throw new RiskConfigDivergenceError(divergences);
  }
  log.warn({ divergences }, 'RiskConfig facade divergence detected — non-blocking');
}
