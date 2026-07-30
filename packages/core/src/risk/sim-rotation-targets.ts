import type { RiskConfig } from '../entities/RiskConfig.js';
import type { GlobalConfig } from '../entities/GlobalConfig.js';
import type { CopyConfig } from '../entities/CopyConfig.js';
import type { CryptoConfig } from '../entities/CryptoConfig.js';
import type { WeatherConfig } from '../entities/WeatherConfig.js';
import type { SimAlgoKind } from '../simulation/algo-kind.js';
import {
  CRYPTO_ALGO_SNAPSHOT_KEYS,
  pickRotationKeys,
  SIM_SESSION_ROTATION_KEYS,
} from './sim-mode-fields.js';

/** Copy-trading sim keys that trigger rotation of the copy algo only. */
const COPY_SIM_ROTATION_KEYS = SIM_SESSION_ROTATION_KEYS.filter(
  (key) =>
    key.startsWith('sim') &&
    key !== 'simInitialCapital' &&
    key !== 'simInitialCapitalCrypto' &&
    key !== 'simInitialCapitalWeather' &&
    key !== 'simInitialCapitalCopy',
) as readonly (keyof RiskConfig)[];

const CRYPTO_ROTATION_KEYS = SIM_SESSION_ROTATION_KEYS.filter((key) =>
  (CRYPTO_ALGO_SNAPSHOT_KEYS as readonly string[]).includes(key as string),
) as readonly (keyof RiskConfig)[];

/** Weather algo keys that trigger rotation of the weather algo only. */
export const WEATHER_SESSION_ROTATION_KEYS = [
  'weatherAlgoEnabled',
  'weatherAlgoSimEnabled',
  'weatherAlgoRealEnabled',
  'weatherAlgoMinEdge',
  'weatherAlgoMaxForecastStd',
  'weatherAlgoSizingMode',
  'weatherAlgoEntryUsdc',
  'weatherAlgoSelectionMode',
  'weatherAlgoMaxSignalsPerEvent',
  'weatherAlgoForecastChangeThreshold',
  'weatherAlgoCloseBeforeResolutionHours',
  'weatherAlgoPollMs',
  'weatherAlgoCityFollowSwitchMode',
  'weatherAlgoBucketHysteresisPolls',
  'weatherAlgoReentryThrottleMs',
] as const satisfies readonly (keyof RiskConfig)[];

function keysChanged(
  before: RiskConfig,
  after: RiskConfig,
  keys: readonly (keyof RiskConfig)[],
): boolean {
  return pickRotationKeys(before, keys) !== pickRotationKeys(after, keys);
}

/**
 * @deprecated Use resolveSimRotationTargetsFromConfigs() instead, which accepts
 * the new per-algo config types (GlobalConfig, CopyConfig, CryptoConfig, WeatherConfig).
 *
 * Determine which algoKind sessions must hard-rotate after a risk-config PUT.
 * Never returns all 3 unless multiple independent groups changed.
 */
export function resolveSimRotationTargets(
  before: RiskConfig,
  after: RiskConfig,
): SimAlgoKind[] {
  const targets = new Set<SimAlgoKind>();

  if (before.simInitialCapitalCrypto !== after.simInitialCapitalCrypto) {
    targets.add('crypto');
  }
  if (before.simInitialCapitalWeather !== after.simInitialCapitalWeather) {
    targets.add('weather');
  }
  if (before.simInitialCapitalCopy !== after.simInitialCapitalCopy) {
    targets.add('copy');
  }
  // Legacy field: treat as crypto-only when per-kind fields unchanged.
  if (
    before.simInitialCapital !== after.simInitialCapital &&
    before.simInitialCapitalCrypto === after.simInitialCapitalCrypto
  ) {
    targets.add('crypto');
  }

  if (keysChanged(before, after, COPY_SIM_ROTATION_KEYS)) {
    targets.add('copy');
  }
  if (keysChanged(before, after, CRYPTO_ROTATION_KEYS)) {
    targets.add('crypto');
  }
  if (keysChanged(before, after, WEATHER_SESSION_ROTATION_KEYS)) {
    targets.add('weather');
  }

  return [...targets];
}

/**
 * New version of resolveSimRotationTargets that accepts per-algo config types.
 * This is the preferred API after the RiskConfig split.
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

  // Crypto-algo rotation keys.
  const cryptoRotationKeys: (keyof CryptoConfig)[] = [
    'cryptoAlgoEnabled', 'cryptoAlgoStrategies', 'cryptoAlgoSlEnabled', 'cryptoAlgoTpEnabled',
    'cryptoAlgoTrailingEnabled', 'cryptoAlgoSlBidPoints', 'cryptoAlgoTpBidPoints',
    'cryptoAlgoTrailingBidPoints', 'cryptoAlgoTrailingActivationBidPoints',
    'cryptoAlgoPreCloseEnabled', 'cryptoAlgoPreCloseSeconds', 'cryptoAlgoPreCloseKeepEnabled',
    'cryptoAlgoPreCloseKeepBidThreshold', 'cryptoAlgoMinTimeToClose',
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

  // Weather-algo rotation keys.
  const weatherRotationKeys: (keyof WeatherConfig)[] = [
    'weatherAlgoEnabled', 'weatherAlgoSimEnabled', 'weatherAlgoRealEnabled',
    'weatherAlgoMinEdge', 'weatherAlgoMaxForecastStd', 'weatherAlgoSizingMode',
    'weatherAlgoEntryUsdc', 'weatherAlgoSelectionMode', 'weatherAlgoMaxSignalsPerEvent',
    'weatherAlgoForecastChangeThreshold', 'weatherAlgoCloseBeforeResolutionHours',
    'weatherAlgoPollMs', 'weatherAlgoCityFollowSwitchMode', 'weatherAlgoBucketHysteresisPolls',
    'weatherAlgoReentryThrottleMs', 'weatherAlgoMaxOpenPositions',
    'weatherAlgoMaxExposureUsdc', 'weatherAlgoMaxDailyLossUsdc', 'weatherAlgoMaxPositionSizeUsdc',
    'weatherAlgoSlBidPoints', 'weatherAlgoTpBidPoints', 'weatherAlgoTrailingBidPoints',
    'weatherAlgoTrailingActivationBidPoints', 'weatherAlgoPreCloseEnabled', 'weatherAlgoPreCloseSeconds',
    'weatherAlgoSlEnabled', 'weatherAlgoTpEnabled', 'weatherAlgoTrailingEnabled',
    'weatherAlgoKillSwitchAction', 'weatherAlgoMinBidToAskRatio', 'weatherAlgoEntryDepthRetryMax',
    'weatherAlgoEntryDepthRetryDelayMs', 'weatherAlgoSlCloseMaxRetries', 'weatherAlgoMinTimeToClose',
    'weatherAlgoAllowedMarketTags', 'weatherAlgoSignalScoreSizingEnabled', 'weatherAlgoSlConfirmationTicks',
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

/** @deprecated Use resolveSimRotationTargets() or resolveSimRotationTargetsFromConfigs(). */
export function simRotationChanged(
  before: RiskConfig,
  after: RiskConfig,
): boolean {
  return resolveSimRotationTargets(before, after).length > 0;
}
