import type { GlobalConfig } from '../entities/GlobalConfig.js';
import type { CopyConfig } from '../entities/CopyConfig.js';
import type { CryptoConfig } from '../entities/CryptoConfig.js';
import type { WeatherConfig } from '../entities/WeatherConfig.js';
import { parseAllowedMarketTags } from '../market/tags.js';

/** Keys of RiskConfig that belong to sim mode settings (single source of truth). */
export const SIM_RISK_CONFIG_KEYS = [
  'simSizingMode',
  'simCopyRatio',
  'simEntryUsdcAmount',
  'simEntryShareCount',
  'simKellyFraction',
  'simRiskBudgetUsdc',
  'simDefaultWinProbability',
  'simInitialCapitalCrypto',
  'simInitialCapitalWeather',
  'simInitialCapitalCopy',
  'simMaxPositionSizeUsdc',
  'simCopyIncreaseEnabled',
  'simCopyDecreaseEnabled',
  'simMaxIncreasesPerPosition',
  'simMinBidToAskRatio',
  'simEntryDepthRetryMax',
  'simEntryDepthRetryDelayMs',
  'simMomentumFilterEnabled',
  'simSlEnabled',
  'simTpEnabled',
  'simSlBidPoints',
  'simSlCloseMaxRetries',
  'simTpBidPoints',
  'simTrailingEnabled',
  'simTrailingBidPoints',
  'simTrailingActivationBidPoints',
  'simPreCloseEnabled',
  'simPreCloseSeconds',
  'simPreCloseKeepEnabled',
  'simPreCloseKeepBidThreshold',
  'simMinTimeToClose',
  'simMaxOpenPositions',
  'simMaxExposureUsdc',
  'simMaxDailyLossUsdc',
  'simKillSwitchAction',
  'simAllowedMarketTags',
  'simSignalScoreSizingEnabled',
  'simAutoSnapshotEnabled',
  'simAutoSnapshotIntervalSeconds',
  'simAutoSnapshotEmptySession',
  'simSnapshotMaxCount',
  'simSnapshotRetentionDays',
  'simSnapshotDecisionWindowHours',
  'slConfirmationTicks',
  'simExecLatencyMode',
  'simExecLatencyMs',
  'simSelfImpactEnabled',
  'simSelfImpactTtlSeconds',
  'simWalletPreflightEnabled',
  'simShadowLoggingEnabled',
  'shadowSampleRetentionDays',
] as const;

export type SimRiskConfigKey = (typeof SIM_RISK_CONFIG_KEYS)[number];

/** Crypto algo keys frozen in snapshots (global; not part of SIM/REAL_RISK_CONFIG_KEYS). */
export const CRYPTO_ALGO_SNAPSHOT_KEYS = [
  'cryptoAlgoEnabled',
  'cryptoAlgoPriceTickCleanupEnabled',
  'cryptoAlgoPriceTickCleanupIntervalMinutes',
  'cryptoAlgoStrategies',
  'cryptoAlgoStrategyParams',
  'cryptoAlgoSlEnabled',
  'cryptoAlgoTpEnabled',
  'cryptoAlgoTrailingEnabled',
  'cryptoAlgoSlBidPoints',
  'cryptoAlgoTpBidPoints',
  'cryptoAlgoTrailingBidPoints',
  'cryptoAlgoTrailingActivationBidPoints',
  'cryptoAlgoPreCloseEnabled',
  'cryptoAlgoPreCloseSeconds',
  'cryptoAlgoPreCloseKeepEnabled',
  'cryptoAlgoPreCloseKeepBidThreshold',
  'cryptoAlgoMinTimeToClose',
  'cryptoAlgoReentryWindowMs',
  'cryptoAlgoMaxEntriesPerWindow',
  'cryptoAlgoBaseThreshold',
  'cryptoAlgoEntryPriceMin',
  'cryptoAlgoEntryPriceMax',
  'cryptoAlgoEntryPriceBandEnabled',
  'cryptoAlgoCurveFilterEnabled',
  'cryptoAlgoCurveLookbackMs',
  'cryptoAlgoCurveMinDelta',
  'cryptoAlgoSpreadAdjustmentFactor',
  'cryptoAlgoMinSpreadAbsForAdjustment',
  'cryptoAlgoMaxSpreadAbs',
  'cryptoAlgoPriceSumTolerance',
  'cryptoAlgoWarnPriceDeviation',
  'cryptoAlgoMaxBookAgeMs',
  'cryptoAlgoGammaCacheTtlShortMs',
  'cryptoAlgoGammaCacheTtlDefaultMs',
  'cryptoAlgoGammaStaleOnErrorFactor',
  'cryptoAlgoWsDebounceMs',
  'cryptoAlgoPollMs',
  'cryptoAlgoTickIntervalMs',
  'cryptoAlgoTickRetentionHours',
  'cryptoAlgoPriceTickRefQty',
  'cryptoAlgoMinTimeToCloseBufferSeconds',
  'cryptoAlgoLastCloseableBidMaxAgeMs',
  'cryptoAlgoSpreadAbsByInterval',
  'cryptoAlgoExitDefaultsByInterval',
  'cryptoAlgoPreCloseSecondsByInterval',
  'cryptoAlgoSlQuotaEnabled',
  'cryptoAlgoSlQuotaPerMarket',
  'cryptoAlgoSlQuotaCacheTtlSeconds',
  'cryptoAlgoSizingMode',
  'cryptoAlgoEntryUsdcAmount',
  'cryptoAlgoEntryShareCount',
] as const;

export type CryptoAlgoSnapshotKey = (typeof CRYPTO_ALGO_SNAPSHOT_KEYS)[number];

type IsolatedSimFields = GlobalConfig & CopyConfig & CryptoConfig;

export type SimRiskConfigSnapshot = {
  [K in Exclude<SimRiskConfigKey, 'simAllowedMarketTags'>]: K extends keyof IsolatedSimFields
    ? IsolatedSimFields[K]
    : never;
} & {
  simAllowedMarketTags: string[];
} & Pick<CryptoConfig, CryptoAlgoSnapshotKey>;

function mergeCryptoAlgoIntoSnapshot(
  snapshot: Record<string, unknown>,
  crypto: CryptoConfig,
): void {
  for (const key of CRYPTO_ALGO_SNAPSHOT_KEYS) {
    snapshot[key] = crypto[key];
  }
}

function buildSimSnapshotFromParts(
  global: GlobalConfig,
  copy: CopyConfig,
  crypto: CryptoConfig,
): SimRiskConfigSnapshot {
  const merged = { ...global, ...copy, ...crypto } as IsolatedSimFields;
  const snapshot = {} as Record<string, unknown>;
  for (const key of SIM_RISK_CONFIG_KEYS) {
    if (key === 'simAllowedMarketTags') continue;
    snapshot[key] = merged[key as keyof IsolatedSimFields];
  }
  snapshot.simAllowedMarketTags = parseAllowedMarketTags(copy.simAllowedMarketTags);
  mergeCryptoAlgoIntoSnapshot(snapshot, crypto);
  return snapshot as SimRiskConfigSnapshot;
}

/**
 * Same JSON shape as legacy session snapshots, built from isolated tables.
 */
export function extractSimConfigSnapshotFromIsolated(
  global: GlobalConfig,
  copy: CopyConfig,
  crypto: CryptoConfig,
): SimRiskConfigSnapshot {
  return buildSimSnapshotFromParts(global, copy, crypto);
}

export const REAL_RISK_CONFIG_KEYS = [
  'realSizingMode',
  'realCopyRatio',
  'realEntryUsdcAmount',
  'realEntryShareCount',
  'realKellyFraction',
  'realRiskBudgetUsdc',
  'realDefaultWinProbability',
  'realMaxPositionSizeUsdc',
  'realCopyIncreaseEnabled',
  'realCopyDecreaseEnabled',
  'realMaxIncreasesPerPosition',
  'realMinBidToAskRatio',
  'realEntryDepthRetryMax',
  'realEntryDepthRetryDelayMs',
  'realMomentumFilterEnabled',
  'realSlEnabled',
  'realTpEnabled',
  'realSlBidPoints',
  'realSlCloseMaxRetries',
  'realTpBidPoints',
  'realTrailingEnabled',
  'realTrailingBidPoints',
  'realTrailingActivationBidPoints',
  'realPreCloseEnabled',
  'realPreCloseSeconds',
  'realPreCloseKeepEnabled',
  'realPreCloseKeepBidThreshold',
  'realMinTimeToClose',
  'realMaxOpenPositions',
  'realMaxExposureUsdc',
  'realMaxDailyLossUsdc',
  'realKillSwitchAction',
  'realAllowedMarketTags',
  'realSignalScoreSizingEnabled',
  'realAutoSnapshotEnabled',
  'realAutoSnapshotIntervalSeconds',
  'realSnapshotMaxCount',
  'realSnapshotRetentionDays',
  'realSnapshotDecisionWindowHours',
  'realCashOverride',
  'slConfirmationTicks',
] as const;

export type RealRiskConfigKey = (typeof REAL_RISK_CONFIG_KEYS)[number];

export type RealRiskConfigSnapshot = {
  [K in Exclude<RealRiskConfigKey, 'realAllowedMarketTags'>]: K extends keyof IsolatedSimFields
    ? IsolatedSimFields[K]
    : never;
} & {
  realAllowedMarketTags: string[];
} & Pick<CryptoConfig, CryptoAlgoSnapshotKey>;

function buildRealSnapshotFromParts(
  global: GlobalConfig,
  copy: CopyConfig,
  crypto: CryptoConfig,
): RealRiskConfigSnapshot {
  const merged = { ...global, ...copy, ...crypto } as IsolatedSimFields;
  const snapshot = {} as Record<string, unknown>;
  for (const key of REAL_RISK_CONFIG_KEYS) {
    if (key === 'realAllowedMarketTags') continue;
    snapshot[key] = merged[key as keyof IsolatedSimFields];
  }
  snapshot.realAllowedMarketTags = parseAllowedMarketTags(copy.realAllowedMarketTags);
  mergeCryptoAlgoIntoSnapshot(snapshot, crypto);
  return snapshot as RealRiskConfigSnapshot;
}

/**
 * Same JSON shape as legacy session snapshots, built from isolated tables.
 */
export function extractRealConfigSnapshotFromIsolated(
  global: GlobalConfig,
  copy: CopyConfig,
  crypto: CryptoConfig,
): RealRiskConfigSnapshot {
  return buildRealSnapshotFromParts(global, copy, crypto);
}

/** Isolated-table key union for session rotation (no RiskConfig entity). */
export type IsolatedSessionRotationKey =
  | keyof GlobalConfig
  | keyof CopyConfig
  | keyof CryptoConfig
  | keyof WeatherConfig;

/**
 * Subset of sim config keys that trigger a session rotation when changed.
 * Excludes meta/ops keys (auto-snapshot, retention, shadow logging, etc.)
 * that should only re-stamp the session config in-place without wiping.
 */
export const SIM_SESSION_ROTATION_KEYS: readonly IsolatedSessionRotationKey[] = [
  'simSizingMode',
  'simCopyRatio',
  'simEntryUsdcAmount',
  'simEntryShareCount',
  'simKellyFraction',
  'simRiskBudgetUsdc',
  'simDefaultWinProbability',
  'simInitialCapitalCrypto',
  'simInitialCapitalWeather',
  'simInitialCapitalCopy',
  'simMaxPositionSizeUsdc',
  'simCopyIncreaseEnabled',
  'simCopyDecreaseEnabled',
  'simMaxIncreasesPerPosition',
  'simMinBidToAskRatio',
  'simEntryDepthRetryMax',
  'simEntryDepthRetryDelayMs',
  'simMomentumFilterEnabled',
  'simSlEnabled',
  'simTpEnabled',
  'simSlBidPoints',
  'simSlCloseMaxRetries',
  'simTpBidPoints',
  'simTrailingEnabled',
  'simTrailingBidPoints',
  'simTrailingActivationBidPoints',
  'simPreCloseEnabled',
  'simPreCloseSeconds',
  'simPreCloseKeepEnabled',
  'simPreCloseKeepBidThreshold',
  'simMinTimeToClose',
  'simMaxOpenPositions',
  'simMaxExposureUsdc',
  'simMaxDailyLossUsdc',
  'simKillSwitchAction',
  'simAllowedMarketTags',
  'simSignalScoreSizingEnabled',
  'slConfirmationTicks',
  'simExecLatencyMode',
  'simExecLatencyMs',
  'simSelfImpactEnabled',
  'simSelfImpactTtlSeconds',
  'simWalletPreflightEnabled',
  'simShadowLoggingEnabled',
  // crypto-algo trading keys (shared with real)
  'cryptoAlgoEnabled',
  'cryptoAlgoStrategies',
  'cryptoAlgoStrategyParams',
  'cryptoAlgoSlEnabled',
  'cryptoAlgoTpEnabled',
  'cryptoAlgoTrailingEnabled',
  'cryptoAlgoSlBidPoints',
  'cryptoAlgoTpBidPoints',
  'cryptoAlgoTrailingBidPoints',
  'cryptoAlgoTrailingActivationBidPoints',
  'cryptoAlgoPreCloseEnabled',
  'cryptoAlgoPreCloseSeconds',
  'cryptoAlgoPreCloseKeepEnabled',
  'cryptoAlgoPreCloseKeepBidThreshold',
  'cryptoAlgoMinTimeToClose',
  'cryptoAlgoReentryWindowMs',
  'cryptoAlgoMaxEntriesPerWindow',
  'cryptoAlgoBaseThreshold',
  'cryptoAlgoEntryPriceMin',
  'cryptoAlgoEntryPriceMax',
  'cryptoAlgoEntryPriceBandEnabled',
  'cryptoAlgoCurveFilterEnabled',
  'cryptoAlgoCurveLookbackMs',
  'cryptoAlgoCurveMinDelta',
  'cryptoAlgoSpreadAdjustmentFactor',
  'cryptoAlgoMinSpreadAbsForAdjustment',
  'cryptoAlgoMaxSpreadAbs',
  'cryptoAlgoPriceSumTolerance',
  'cryptoAlgoWarnPriceDeviation',
  'cryptoAlgoMaxBookAgeMs',
  'cryptoAlgoGammaCacheTtlShortMs',
  'cryptoAlgoGammaCacheTtlDefaultMs',
  'cryptoAlgoGammaStaleOnErrorFactor',
  'cryptoAlgoWsDebounceMs',
  'cryptoAlgoPollMs',
  'cryptoAlgoTickIntervalMs',
  'cryptoAlgoTickRetentionHours',
  'cryptoAlgoPriceTickRefQty',
  'cryptoAlgoMinTimeToCloseBufferSeconds',
  'cryptoAlgoLastCloseableBidMaxAgeMs',
  'cryptoAlgoSpreadAbsByInterval',
  'cryptoAlgoExitDefaultsByInterval',
  'cryptoAlgoPreCloseSecondsByInterval',
  'cryptoAlgoSlQuotaEnabled',
  'cryptoAlgoSlQuotaPerMarket',
  'cryptoAlgoSlQuotaCacheTtlSeconds',
  'cryptoAlgoSizingMode',
  'cryptoAlgoEntryUsdcAmount',
  'cryptoAlgoEntryShareCount',
];

/**
 * Subset of real config keys that trigger a session rotation when changed.
 * Excludes meta/ops keys (auto-snapshot, retention, cash override).
 */
export const REAL_SESSION_ROTATION_KEYS: readonly IsolatedSessionRotationKey[] = [
  'realSizingMode',
  'realCopyRatio',
  'realEntryUsdcAmount',
  'realEntryShareCount',
  'realKellyFraction',
  'realRiskBudgetUsdc',
  'realDefaultWinProbability',
  'realMaxPositionSizeUsdc',
  'realCopyIncreaseEnabled',
  'realCopyDecreaseEnabled',
  'realMaxIncreasesPerPosition',
  'realMinBidToAskRatio',
  'realEntryDepthRetryMax',
  'realEntryDepthRetryDelayMs',
  'realMomentumFilterEnabled',
  'realSlEnabled',
  'realTpEnabled',
  'realSlBidPoints',
  'realSlCloseMaxRetries',
  'realTpBidPoints',
  'realTrailingEnabled',
  'realTrailingBidPoints',
  'realTrailingActivationBidPoints',
  'realPreCloseEnabled',
  'realPreCloseSeconds',
  'realPreCloseKeepEnabled',
  'realPreCloseKeepBidThreshold',
  'realMinTimeToClose',
  'realMaxOpenPositions',
  'realMaxExposureUsdc',
  'realMaxDailyLossUsdc',
  'realKillSwitchAction',
  'realAllowedMarketTags',
  'realSignalScoreSizingEnabled',
  'slConfirmationTicks',
  // crypto-algo trading keys (shared with sim)
  'cryptoAlgoEnabled',
  'cryptoAlgoStrategies',
  'cryptoAlgoStrategyParams',
  'cryptoAlgoSlEnabled',
  'cryptoAlgoTpEnabled',
  'cryptoAlgoTrailingEnabled',
  'cryptoAlgoSlBidPoints',
  'cryptoAlgoTpBidPoints',
  'cryptoAlgoTrailingBidPoints',
  'cryptoAlgoTrailingActivationBidPoints',
  'cryptoAlgoPreCloseEnabled',
  'cryptoAlgoPreCloseSeconds',
  'cryptoAlgoPreCloseKeepEnabled',
  'cryptoAlgoPreCloseKeepBidThreshold',
  'cryptoAlgoMinTimeToClose',
  'cryptoAlgoReentryWindowMs',
  'cryptoAlgoMaxEntriesPerWindow',
  'cryptoAlgoBaseThreshold',
  'cryptoAlgoEntryPriceMin',
  'cryptoAlgoEntryPriceMax',
  'cryptoAlgoEntryPriceBandEnabled',
  'cryptoAlgoCurveFilterEnabled',
  'cryptoAlgoCurveLookbackMs',
  'cryptoAlgoCurveMinDelta',
  'cryptoAlgoSpreadAdjustmentFactor',
  'cryptoAlgoMinSpreadAbsForAdjustment',
  'cryptoAlgoMaxSpreadAbs',
  'cryptoAlgoPriceSumTolerance',
  'cryptoAlgoWarnPriceDeviation',
  'cryptoAlgoMaxBookAgeMs',
  'cryptoAlgoGammaCacheTtlShortMs',
  'cryptoAlgoGammaCacheTtlDefaultMs',
  'cryptoAlgoGammaStaleOnErrorFactor',
  'cryptoAlgoWsDebounceMs',
  'cryptoAlgoPollMs',
  'cryptoAlgoTickIntervalMs',
  'cryptoAlgoTickRetentionHours',
  'cryptoAlgoPriceTickRefQty',
  'cryptoAlgoMinTimeToCloseBufferSeconds',
  'cryptoAlgoLastCloseableBidMaxAgeMs',
  'cryptoAlgoSpreadAbsByInterval',
  'cryptoAlgoExitDefaultsByInterval',
  'cryptoAlgoPreCloseSecondsByInterval',
  'cryptoAlgoSlQuotaEnabled',
  'cryptoAlgoSlQuotaPerMarket',
  'cryptoAlgoSlQuotaCacheTtlSeconds',
  'cryptoAlgoSizingMode',
  'cryptoAlgoEntryUsdcAmount',
  'cryptoAlgoEntryShareCount',
];

/** Rotation-relevant keys typed for isolated configs. */
export const SIM_SESSION_ROTATION_KEYS_ISOLATED = SIM_SESSION_ROTATION_KEYS;

/** Rotation-relevant keys typed for isolated configs. */
export const REAL_SESSION_ROTATION_KEYS_ISOLATED = REAL_SESSION_ROTATION_KEYS;

/**
 * Pick rotation-relevant keys from isolated configs (stable JSON for comparison).
 */
export function pickRotationKeysFromIsolated(
  global: GlobalConfig,
  copy: CopyConfig,
  crypto: CryptoConfig,
  keys: readonly IsolatedSessionRotationKey[],
): string {
  const merged = { ...global, ...copy, ...crypto } as Record<string, unknown>;
  const picked: Record<string, unknown> = {};
  for (const key of keys) {
    picked[key as string] = merged[key as string];
  }
  return JSON.stringify(picked, Object.keys(picked).sort());
}

export function realRotationChangedFromIsolated(
  before: { global: GlobalConfig; copy: CopyConfig; crypto: CryptoConfig },
  after: { global: GlobalConfig; copy: CopyConfig; crypto: CryptoConfig },
): boolean {
  return (
    pickRotationKeysFromIsolated(
      before.global,
      before.copy,
      before.crypto,
      REAL_SESSION_ROTATION_KEYS_ISOLATED,
    ) !==
    pickRotationKeysFromIsolated(
      after.global,
      after.copy,
      after.crypto,
      REAL_SESSION_ROTATION_KEYS_ISOLATED,
    )
  );
}
