import type { GlobalConfig } from '../entities/GlobalConfig.js';
import type { CopyConfig } from '../entities/CopyConfig.js';
import type { CryptoConfig } from '../entities/CryptoConfig.js';
import type { WeatherConfig } from '../entities/WeatherConfig.js';
import type { SimAlgoKind } from '../simulation/algo-kind.js';

/**
 * Determine which algoKind sessions must hard-rotate after isolated config PUTs.
 * Never returns all 3 unless multiple independent groups changed.
 */
export function resolveSimRotationTargetsFromConfigs(
  before: {
    global?: GlobalConfig;
    copy?: CopyConfig;
    crypto?: CryptoConfig;
    weather?: WeatherConfig;
  },
  after: {
    global?: GlobalConfig;
    copy?: CopyConfig;
    crypto?: CryptoConfig;
    weather?: WeatherConfig;
  },
): SimAlgoKind[] {
  const targets = new Set<SimAlgoKind>();

  if (isSimInitialCapitalChanged(before.crypto?.simInitialCapitalCrypto, after.crypto?.simInitialCapitalCrypto)) {
    targets.add('crypto');
  }
  if (isSimInitialCapitalChanged(before.weather?.simInitialCapitalWeather, after.weather?.simInitialCapitalWeather)) {
    targets.add('weather');
  }
  if (isSimInitialCapitalChanged(before.copy?.simInitialCapitalCopy, after.copy?.simInitialCapitalCopy)) {
    targets.add('copy');
  }

  // Copy-trading keys that trigger rotation of the copy algo only.
  const copyRotationKeys: (keyof CopyConfig)[] = [
    'simSizingMode', 'simCopyRatio', 'simEntryUsdcAmount', 'simEntryShareCount',
    'simKellyFraction', 'simRiskBudgetUsdc', 'simDefaultWinProbability',
    'simMaxPositionSizeUsdc', 'simCopyIncreaseEnabled', 'simCopyDecreaseEnabled',
    'simMaxIncreasesPerPosition', 'simMinBidToAskRatio', 'simEntryDepthRetryMax',
    'simEntryDepthRetryDelayMs', 'simMomentumFilterEnabled', 'simSlEnabled',
    'simTpEnabled', 'simSlBidPoints', 'simSlCloseMaxRetries', 'simTpBidPoints',
    'simTrailingEnabled', 'simTrailingBidPoints', 'simTrailingActivationBidPoints',
    'simPreCloseEnabled', 'simPreCloseSeconds', 'simPreCloseKeepEnabled',
    'simPreCloseKeepBidThreshold', 'simMinTimeToClose', 'simMaxOpenPositions',
    'simMaxExposureUsdc', 'simMaxDailyLossUsdc', 'simKillSwitchAction',
    'simAllowedMarketTags', 'simSignalScoreSizingEnabled', 'slConfirmationTicks',
  ];
  if (hasChangedKeys(before.copy, after.copy, copyRotationKeys)) {
    targets.add('copy');
  }

  // Global keys that affect copy sim rotation (execution realism, slippage guard).
  const globalCopyRotationKeys: (keyof GlobalConfig)[] = [
    'maxSlippagePercent',
    'simExecLatencyMode',
    'simExecLatencyMs',
    'simSelfImpactEnabled',
    'simSelfImpactTtlSeconds',
    'simWalletPreflightEnabled',
    'simShadowLoggingEnabled',
    'shadowSampleRetentionDays',
  ];
  if (hasChangedKeys(before.global, after.global, globalCopyRotationKeys)) {
    targets.add('copy');
  }

  // Crypto-algo rotation keys.
  const cryptoRotationKeys: (keyof CryptoConfig)[] = [
    'cryptoAlgoEnabled', 'cryptoAlgoStrategies', 'cryptoAlgoSlEnabled', 'cryptoAlgoTpEnabled',
    'cryptoAlgoTrailingEnabled', 'cryptoAlgoSlBidPoints', 'cryptoAlgoTpBidPoints',
    'cryptoAlgoTrailingBidPoints', 'cryptoAlgoTrailingActivationBidPoints',
    'cryptoAlgoPreCloseEnabled', 'cryptoAlgoPreCloseSeconds', 'cryptoAlgoPreCloseKeepEnabled',
    'cryptoAlgoPreCloseKeepBidThreshold', 'cryptoAlgoMinTimeToClose',
    'cryptoAlgoStrategyParams',
    'cryptoAlgoReentryWindowMs', 'cryptoAlgoMaxEntriesPerWindow', 'cryptoAlgoBaseThreshold',
    'cryptoAlgoEntryPriceMin', 'cryptoAlgoEntryPriceMax', 'cryptoAlgoEntryPriceBandEnabled',
    'cryptoAlgoCurveFilterEnabled', 'cryptoAlgoCurveLookbackMs', 'cryptoAlgoCurveMinDelta',
    'cryptoAlgoSpreadAdjustmentFactor', 'cryptoAlgoMinSpreadAbsForAdjustment', 'cryptoAlgoMaxSpreadAbs',
    'cryptoAlgoPriceSumTolerance', 'cryptoAlgoWarnPriceDeviation', 'cryptoAlgoMaxBookAgeMs',
    'cryptoAlgoWsDebounceMs', 'cryptoAlgoPollMs', 'cryptoAlgoTickIntervalMs',
    'cryptoAlgoTickRetentionHours', 'cryptoAlgoPriceTickRefQty', 'cryptoAlgoMinTimeToCloseBufferSeconds',
    'cryptoAlgoLastCloseableBidMaxAgeMs', 'cryptoAlgoSpreadAbsByInterval', 'cryptoAlgoExitDefaultsByInterval',
    'cryptoAlgoPreCloseSecondsByInterval', 'cryptoAlgoSlQuotaEnabled', 'cryptoAlgoSlQuotaPerMarket',
    'cryptoAlgoSlQuotaCacheTtlSeconds', 'cryptoAlgoSizingMode', 'cryptoAlgoEntryUsdcAmount',
    'cryptoAlgoEntryShareCount', 'cryptoAlgoMaxOpenPositions', 'cryptoAlgoMaxExposureUsdc',
    'cryptoAlgoMaxDailyLossUsdc', 'cryptoAlgoMaxPositionSizeUsdc', 'cryptoAlgoKillSwitchAction',
    'cryptoAlgoMinBidToAskRatio', 'cryptoAlgoEntryDepthRetryMax', 'cryptoAlgoEntryDepthRetryDelayMs',
    'cryptoAlgoSlCloseMaxRetries', 'cryptoAlgoAllowedMarketTags', 'cryptoAlgoSignalScoreSizingEnabled',
    'cryptoAlgoSlConfirmationTicks',
  ];
  if (hasChangedKeys(before.crypto, after.crypto, cryptoRotationKeys)) {
    targets.add('crypto');
  }

  if (hasChangedKeys(before.global, after.global, globalCopyRotationKeys)) {
    targets.add('crypto');
  }

  // Weather-algo rotation keys. Per-strategy tunables live in
  // weatherAlgoStrategyParams (JSON), which triggers rotation as a whole.
  const weatherRotationKeys: (keyof WeatherConfig)[] = [
    'weatherAlgoEnabled', 'weatherAlgoSimEnabled', 'weatherAlgoRealEnabled',
    'weatherAlgoSelectionMode', 'weatherAlgoMaxSignalsPerEvent',
    'weatherAlgoPollMs',
    'weatherAlgoForecastHistoryRecordingEnabled', 'weatherAlgoMarketSnapshotRecordingEnabled',
    'weatherAlgoEvaluationLogRecordingEnabled',
    'weatherAlgoForecastHistoryRetentionDays', 'weatherAlgoMarketSnapshotRetentionDays',
    'weatherAlgoEvaluationLogRetentionDays',
    'weatherAlgoStrategies', 'weatherAlgoStrategyParams',
  ];
  if (hasChangedKeys(before.weather, after.weather, weatherRotationKeys)) {
    targets.add('weather');
  }

  return [...targets];
}

function isSimInitialCapitalChanged(a: number | undefined, b: number | undefined): boolean {
  return a !== b;
}

function hasChangedKeys<T extends object>(
  before: T | undefined,
  after: T | undefined,
  keys: readonly (keyof T)[],
): boolean {
  if (!before || !after) return false;
  return keys.some((key) => before[key] !== after[key]);
}
