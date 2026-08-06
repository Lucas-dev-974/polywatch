import type { RiskConfig } from '../entities/RiskConfig.js';
import type { GlobalConfig } from '../entities/GlobalConfig.js';
import type { CopyConfig } from '../entities/CopyConfig.js';
import type { CryptoConfig } from '../entities/CryptoConfig.js';
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

export type SimRiskConfigSnapshot = Omit<
  Pick<RiskConfig, Exclude<SimRiskConfigKey, 'simAllowedMarketTags'>>,
  never
> & {
  simAllowedMarketTags: string[];
} & Pick<RiskConfig, CryptoAlgoSnapshotKey>;

function mergeCryptoAlgoIntoSnapshot(
  snapshot: Record<string, unknown>,
  config: RiskConfig,
): void {
  for (const key of CRYPTO_ALGO_SNAPSHOT_KEYS) {
    snapshot[key] = config[key];
  }
}

export function extractSimConfigSnapshot(config: RiskConfig): SimRiskConfigSnapshot {
  const snapshot = {} as Record<string, unknown>;
  for (const key of SIM_RISK_CONFIG_KEYS) {
    if (key === 'simAllowedMarketTags') continue;
    snapshot[key] = config[key];
  }
  snapshot.simAllowedMarketTags = parseAllowedMarketTags(config.simAllowedMarketTags);
  mergeCryptoAlgoIntoSnapshot(snapshot, config);
  return snapshot as SimRiskConfigSnapshot;
}

/**
 * Same JSON shape as {@link extractSimConfigSnapshot} for DB/session compat,
 * built from isolated tables (no RiskConfig entity required).
 */
export function extractSimConfigSnapshotFromIsolated(
  global: GlobalConfig,
  copy: CopyConfig,
  crypto: CryptoConfig,
): SimRiskConfigSnapshot {
  return extractSimConfigSnapshot({
    ...global,
    ...copy,
    ...crypto,
    id: 0,
  } as unknown as RiskConfig);
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

export type RealRiskConfigSnapshot = Omit<
  Pick<RiskConfig, Exclude<RealRiskConfigKey, 'realAllowedMarketTags'>>,
  never
> & {
  realAllowedMarketTags: string[];
} & Pick<RiskConfig, CryptoAlgoSnapshotKey>;

export function extractRealConfigSnapshot(config: RiskConfig): RealRiskConfigSnapshot {
  const snapshot = {} as Record<string, unknown>;
  for (const key of REAL_RISK_CONFIG_KEYS) {
    if (key === 'realAllowedMarketTags') continue;
    snapshot[key] = config[key];
  }
  snapshot.realAllowedMarketTags = parseAllowedMarketTags(config.realAllowedMarketTags);
  mergeCryptoAlgoIntoSnapshot(snapshot, config);
  return snapshot as RealRiskConfigSnapshot;
}

/**
 * Same JSON shape as {@link extractRealConfigSnapshot} for DB/session compat,
 * built from isolated tables (no RiskConfig entity required).
 */
export function extractRealConfigSnapshotFromIsolated(
  global: GlobalConfig,
  copy: CopyConfig,
  crypto: CryptoConfig,
): RealRiskConfigSnapshot {
  return extractRealConfigSnapshot({
    ...global,
    ...copy,
    ...crypto,
    id: 0,
  } as unknown as RiskConfig);
}

/** Isolated-table key union for session rotation (no RiskConfig entity). */
export type IsolatedSessionRotationKey =
  | keyof GlobalConfig
  | keyof CopyConfig
  | keyof CryptoConfig;

/**
 * Subset of sim config keys that trigger a session rotation when changed.
 * Excludes meta/ops keys (auto-snapshot, retention, shadow logging, etc.)
 * that should only re-stamp the session config in-place without wiping.
 */
export const SIM_SESSION_ROTATION_KEYS: readonly (keyof RiskConfig)[] = [
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
export const REAL_SESSION_ROTATION_KEYS: readonly (keyof RiskConfig)[] = [
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

/**
 * Pick a subset of keys from a RiskConfig object, returning a stable JSON
 * string for comparison. Used to detect whether rotation-relevant keys changed.
 */
export function pickRotationKeys(
  config: RiskConfig,
  keys: readonly (keyof RiskConfig)[],
): string {
  const picked: Record<string, unknown> = {};
  for (const key of keys) {
    picked[key as string] = config[key];
  }
  return JSON.stringify(picked, Object.keys(picked).sort());
}

export function realRotationChanged(
  before: RiskConfig,
  after: RiskConfig,
): boolean {
  return pickRotationKeys(before, REAL_SESSION_ROTATION_KEYS) !==
    pickRotationKeys(after, REAL_SESSION_ROTATION_KEYS);
}

/** Same keys as {@link SIM_SESSION_ROTATION_KEYS}, typed for isolated configs. */
export const SIM_SESSION_ROTATION_KEYS_ISOLATED =
  SIM_SESSION_ROTATION_KEYS as unknown as readonly IsolatedSessionRotationKey[];

/** Same keys as {@link REAL_SESSION_ROTATION_KEYS}, typed for isolated configs. */
export const REAL_SESSION_ROTATION_KEYS_ISOLATED =
  REAL_SESSION_ROTATION_KEYS as unknown as readonly IsolatedSessionRotationKey[];

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
