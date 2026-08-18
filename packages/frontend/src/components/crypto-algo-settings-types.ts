import { type EnvSettings } from './env-settings-types';

export type CryptoAlgoIntervalExitDefaults = {
  slBidPoints?: number;
  tpBidPoints?: number;
  trailingBidPoints?: number;
  trailingActivationBidPoints?: number;
};

export type CryptoAlgoSettings = Pick<
  EnvSettings,
  | 'cryptoAlgoEnabled'
  | 'cryptoAlgoRecordingEnabled'
  | 'cryptoAlgoPriceTickCleanupEnabled'
  | 'cryptoAlgoPriceTickCleanupIntervalMinutes'
  | 'cryptoAlgoStrategies'
  | 'cryptoAlgoSlEnabled'
  | 'cryptoAlgoTpEnabled'
  | 'cryptoAlgoTrailingEnabled'
  | 'cryptoAlgoSlBidPoints'
  | 'cryptoAlgoTpBidPoints'
  | 'cryptoAlgoTrailingBidPoints'
  | 'cryptoAlgoTrailingActivationBidPoints'
  | 'cryptoAlgoPreCloseEnabled'
  | 'cryptoAlgoPreCloseSeconds'
  | 'cryptoAlgoPreCloseKeepEnabled'
  | 'cryptoAlgoPreCloseKeepBidThreshold'
  | 'cryptoAlgoMinTimeToClose'
  | 'cryptoAlgoReentryWindowMs'
  | 'cryptoAlgoMaxEntriesPerWindow'
  | 'cryptoAlgoBaseThreshold'
  | 'cryptoAlgoEntryPriceMin'
  | 'cryptoAlgoEntryPriceMax'
  | 'cryptoAlgoEntryPriceBandEnabled'
  | 'cryptoAlgoCurveFilterEnabled'
  | 'cryptoAlgoCurveLookbackMs'
  | 'cryptoAlgoCurveMinDelta'
  | 'cryptoAlgoSpreadAdjustmentFactor'
  | 'cryptoAlgoMinSpreadAbsForAdjustment'
  | 'cryptoAlgoMaxSpreadAbs'
  | 'cryptoAlgoPriceSumTolerance'
  | 'cryptoAlgoWarnPriceDeviation'
  | 'cryptoAlgoMaxBookAgeMs'
  | 'cryptoAlgoGammaCacheTtlShortMs'
  | 'cryptoAlgoGammaCacheTtlDefaultMs'
  | 'cryptoAlgoGammaStaleOnErrorFactor'
  | 'cryptoAlgoWsDebounceMs'
  | 'cryptoAlgoPollMs'
  | 'cryptoAlgoTickIntervalMs'
  | 'cryptoAlgoTickRetentionHours'
  | 'cryptoAlgoPriceTickRefQty'
  | 'cryptoAlgoMinTimeToCloseBufferSeconds'
  | 'cryptoAlgoLastCloseableBidMaxAgeMs'
  | 'cryptoAlgoSpreadAbsByInterval'
  | 'cryptoAlgoExitDefaultsByInterval'
  | 'cryptoAlgoPreCloseSecondsByInterval'
  | 'cryptoAlgoSlQuotaEnabled'
  | 'cryptoAlgoSlQuotaPerMarket'
  | 'cryptoAlgoSlQuotaCacheTtlSeconds'
  | 'cryptoAlgoSizingMode'
  | 'cryptoAlgoEntryUsdcAmount'
  | 'cryptoAlgoEntryShareCount'
  | 'maxSlippagePercent'
>;

export function pickCryptoAlgoFields(config: EnvSettings): CryptoAlgoSettings {
  return {
    cryptoAlgoEnabled: config.cryptoAlgoEnabled,
    cryptoAlgoRecordingEnabled: config.cryptoAlgoRecordingEnabled,
    cryptoAlgoPriceTickCleanupEnabled: config.cryptoAlgoPriceTickCleanupEnabled,
    cryptoAlgoPriceTickCleanupIntervalMinutes: config.cryptoAlgoPriceTickCleanupIntervalMinutes,
    cryptoAlgoStrategies: config.cryptoAlgoStrategies,
    cryptoAlgoSlEnabled: config.cryptoAlgoSlEnabled,
    cryptoAlgoTpEnabled: config.cryptoAlgoTpEnabled,
    cryptoAlgoTrailingEnabled: config.cryptoAlgoTrailingEnabled,
    cryptoAlgoSlBidPoints: config.cryptoAlgoSlBidPoints,
    cryptoAlgoTpBidPoints: config.cryptoAlgoTpBidPoints,
    cryptoAlgoTrailingBidPoints: config.cryptoAlgoTrailingBidPoints,
    cryptoAlgoTrailingActivationBidPoints: config.cryptoAlgoTrailingActivationBidPoints,
    cryptoAlgoPreCloseEnabled: config.cryptoAlgoPreCloseEnabled,
    cryptoAlgoPreCloseSeconds: config.cryptoAlgoPreCloseSeconds,
    cryptoAlgoPreCloseKeepEnabled: config.cryptoAlgoPreCloseKeepEnabled,
    cryptoAlgoPreCloseKeepBidThreshold: config.cryptoAlgoPreCloseKeepBidThreshold,
    cryptoAlgoMinTimeToClose: config.cryptoAlgoMinTimeToClose,
    cryptoAlgoReentryWindowMs: config.cryptoAlgoReentryWindowMs,
    cryptoAlgoMaxEntriesPerWindow: config.cryptoAlgoMaxEntriesPerWindow,
    cryptoAlgoBaseThreshold: config.cryptoAlgoBaseThreshold,
    cryptoAlgoEntryPriceMin: config.cryptoAlgoEntryPriceMin,
    cryptoAlgoEntryPriceMax: config.cryptoAlgoEntryPriceMax,
    cryptoAlgoEntryPriceBandEnabled: config.cryptoAlgoEntryPriceBandEnabled,
    cryptoAlgoCurveFilterEnabled: config.cryptoAlgoCurveFilterEnabled,
    cryptoAlgoCurveLookbackMs: config.cryptoAlgoCurveLookbackMs,
    cryptoAlgoCurveMinDelta: config.cryptoAlgoCurveMinDelta,
    cryptoAlgoSpreadAdjustmentFactor: config.cryptoAlgoSpreadAdjustmentFactor,
    cryptoAlgoMinSpreadAbsForAdjustment: config.cryptoAlgoMinSpreadAbsForAdjustment,
    cryptoAlgoMaxSpreadAbs: config.cryptoAlgoMaxSpreadAbs,
    cryptoAlgoPriceSumTolerance: config.cryptoAlgoPriceSumTolerance,
    cryptoAlgoWarnPriceDeviation: config.cryptoAlgoWarnPriceDeviation,
    cryptoAlgoMaxBookAgeMs: config.cryptoAlgoMaxBookAgeMs,
    cryptoAlgoGammaCacheTtlShortMs: config.cryptoAlgoGammaCacheTtlShortMs,
    cryptoAlgoGammaCacheTtlDefaultMs: config.cryptoAlgoGammaCacheTtlDefaultMs,
    cryptoAlgoGammaStaleOnErrorFactor: config.cryptoAlgoGammaStaleOnErrorFactor,
    cryptoAlgoWsDebounceMs: config.cryptoAlgoWsDebounceMs,
    cryptoAlgoPollMs: config.cryptoAlgoPollMs,
    cryptoAlgoTickIntervalMs: config.cryptoAlgoTickIntervalMs,
    cryptoAlgoTickRetentionHours: config.cryptoAlgoTickRetentionHours,
    cryptoAlgoPriceTickRefQty: config.cryptoAlgoPriceTickRefQty,
    cryptoAlgoMinTimeToCloseBufferSeconds: config.cryptoAlgoMinTimeToCloseBufferSeconds,
    cryptoAlgoLastCloseableBidMaxAgeMs: config.cryptoAlgoLastCloseableBidMaxAgeMs,
    cryptoAlgoSpreadAbsByInterval: config.cryptoAlgoSpreadAbsByInterval,
    cryptoAlgoExitDefaultsByInterval: config.cryptoAlgoExitDefaultsByInterval,
    cryptoAlgoPreCloseSecondsByInterval: config.cryptoAlgoPreCloseSecondsByInterval,
    cryptoAlgoSlQuotaEnabled: config.cryptoAlgoSlQuotaEnabled,
    cryptoAlgoSlQuotaPerMarket: config.cryptoAlgoSlQuotaPerMarket,
    cryptoAlgoSlQuotaCacheTtlSeconds: config.cryptoAlgoSlQuotaCacheTtlSeconds,
    cryptoAlgoSizingMode: config.cryptoAlgoSizingMode,
    cryptoAlgoEntryUsdcAmount: config.cryptoAlgoEntryUsdcAmount,
    cryptoAlgoEntryShareCount: config.cryptoAlgoEntryShareCount,
    maxSlippagePercent: config.maxSlippagePercent,
  };
}

/**
 * Code defaults for JSON interval map placeholders.
 * Keep in sync with `@polywatch/core` tables
 * (`DEFAULT_CRYPTO_ALGO_SPREAD_ABS_BY_INTERVAL`, `CRYPTO_INTERVAL_*`).
 * Not imported from core to avoid pulling Node deps into the Vite bundle (C7.1).
 */
export const CODE_DEFAULT_SPREAD_ABS_BY_INTERVAL: Record<string, number> = {
  '5m': 0.05,
  '10m': 0.04,
  '15m': 0.03,
  '30m': 0.03,
  '1h': 0.02,
  '4h': 0.02,
  '1d': 0.02,
};

export const CODE_DEFAULT_EXIT_BY_INTERVAL: Record<string, CryptoAlgoIntervalExitDefaults> = {
  '5m': { slBidPoints: 0.1, tpBidPoints: 0.12, trailingBidPoints: 0.18, trailingActivationBidPoints: 0.1 },
  '10m': { slBidPoints: 0.1, tpBidPoints: 0.12, trailingBidPoints: 0.18, trailingActivationBidPoints: 0.1 },
  '15m': { slBidPoints: 0.1, tpBidPoints: 0.12, trailingBidPoints: 0.2, trailingActivationBidPoints: 0.1 },
  '30m': { slBidPoints: 0.1, tpBidPoints: 0.12, trailingBidPoints: 0.2, trailingActivationBidPoints: 0.12 },
  '1h': { slBidPoints: 0.1, tpBidPoints: 0.12, trailingBidPoints: 0.22, trailingActivationBidPoints: 0.15 },
  '4h': { slBidPoints: 0.1, tpBidPoints: 0.12, trailingBidPoints: 0.25, trailingActivationBidPoints: 0.15 },
  '1d': { slBidPoints: 0.1, tpBidPoints: 0.12, trailingBidPoints: 0.25, trailingActivationBidPoints: 0.18 },
};

export const CODE_DEFAULT_PRE_CLOSE_SECONDS: Record<string, number> = {
  '5m': 120,
  '10m': 120,
  '15m': 180,
  '30m': 240,
  '1h': 300,
  '4h': 600,
  '1d': 600,
};

const VALID_INTERVALS = ['5m', '10m', '15m', '30m', '1h', '4h', '1d'] as const;

export function validateIntervalJsonMap(
  raw: string,
  valueKind: 'number' | 'seconds' | 'exit',
): { value: Record<string, unknown> | null; error: string | null } {
  const trimmed = raw.trim();
  if (trimmed === '' || trimmed === 'null') {
    return { value: null, error: null };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { value: null, error: 'JSON invalide' };
  }
  if (parsed == null) return { value: null, error: null };
  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { value: null, error: 'Le JSON doit être un objet' };
  }
  const obj = parsed as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (!VALID_INTERVALS.includes(key as (typeof VALID_INTERVALS)[number])) {
      return {
        value: null,
        error: `Clé invalide "${key}" (autorisé : ${VALID_INTERVALS.join(', ')})`,
      };
    }
    const entry = obj[key];
    if (valueKind === 'number' || valueKind === 'seconds') {
      if (typeof entry !== 'number' || !Number.isFinite(entry)) {
        return { value: null, error: `"${key}" doit être un nombre` };
      }
      if (valueKind === 'seconds' && !Number.isInteger(entry)) {
        return {
          value: null,
          error: `"${key}" doit être un entier (secondes)`,
        };
      }
    } else if (entry == null || typeof entry !== 'object' || Array.isArray(entry)) {
      return { value: null, error: `"${key}" doit être un objet` };
    }
  }
  return { value: obj, error: null };
}
