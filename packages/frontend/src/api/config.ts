// ─── Config API : Global / Copy / Crypto / Weather + EnvSettings legacy ───

import type { EnvSettings } from '../components/env-settings-types';
import { api } from './http';

export interface GlobalConfig {
  maxSlippagePercent: number;
  exitSlippageGuardPercent: number;
  realTradingEnabled: boolean;
  realCashOverride: number | null;
  simExecLatencyMode: string | null;
  simExecLatencyMs: number | null;
  simSelfImpactEnabled: boolean | null;
  simSelfImpactTtlSeconds: number | null;
  simWalletPreflightEnabled: boolean | null;
  simShadowLoggingEnabled: boolean | null;
  shadowSampleRetentionDays: number | null;
  simAutoSnapshotEnabled: boolean;
  simAutoSnapshotIntervalSeconds: number;
  simSnapshotMaxCount: number | null;
  simSnapshotRetentionDays: number | null;
  simAutoSnapshotEmptySession: boolean;
  simSnapshotDecisionWindowHours: number;
  realAutoSnapshotEnabled: boolean;
  realAutoSnapshotIntervalSeconds: number;
  realSnapshotMaxCount: number | null;
  realSnapshotRetentionDays: number | null;
  realSnapshotDecisionWindowHours: number;
}

export interface CopyConfig {
  simMaxOpenPositions: number;
  realMaxOpenPositions: number;
  simMaxExposureUsdc: number;
  realMaxExposureUsdc: number;
  simMaxDailyLossUsdc: number;
  realMaxDailyLossUsdc: number;
  simMaxPositionSizeUsdc: number;
  realMaxPositionSizeUsdc: number;
  simMinBidToAskRatio: number;
  realMinBidToAskRatio: number;
  simMomentumFilterEnabled: boolean;
  realMomentumFilterEnabled: boolean;
  simCopyTradingEnabled: boolean;
  realCopyTradingEnabled: boolean;
  simSizingMode: string;
  simCopyRatio: number;
  simEntryUsdcAmount: number;
  simEntryShareCount: number;
  simKellyFraction: number;
  simRiskBudgetUsdc: number;
  simDefaultWinProbability: number;
  realSizingMode: string;
  realCopyRatio: number;
  realEntryUsdcAmount: number;
  realEntryShareCount: number;
  realKellyFraction: number;
  realRiskBudgetUsdc: number;
  realDefaultWinProbability: number;
  simTrailingEnabled: boolean;
  simTrailingPercent: number;
  simTrailingActivationPercent: number;
  realTrailingEnabled: boolean;
  realTrailingPercent: number;
  realTrailingActivationPercent: number;
  simSlEnabled: boolean;
  simTpEnabled: boolean;
  realSlEnabled: boolean;
  realTpEnabled: boolean;
  simSlPercent: number;
  simTpPercent: number;
  realSlPercent: number;
  realTpPercent: number;
  simSlCloseMaxRetries: number;
  realSlCloseMaxRetries: number;
  simEntryDepthRetryMax: number;
  simEntryDepthRetryDelayMs: number;
  realEntryDepthRetryMax: number;
  realEntryDepthRetryDelayMs: number;
  simKillSwitchAction: string;
  realKillSwitchAction: string;
  simCopyIncreaseEnabled: boolean;
  realCopyIncreaseEnabled: boolean;
  simCopyDecreaseEnabled: boolean;
  realCopyDecreaseEnabled: boolean;
  simMaxIncreasesPerPosition: number;
  realMaxIncreasesPerPosition: number;
  simCopyIncreaseSlProximityEnabled: boolean;
  realCopyIncreaseSlProximityEnabled: boolean;
  simCopyIncreaseSlProximityPercent: number;
  realCopyIncreaseSlProximityPercent: number;
  simPreCloseEnabled: boolean;
  realPreCloseEnabled: boolean;
  simPreCloseSeconds: number;
  realPreCloseSeconds: number;
  simMinTimeToClose: number;
  realMinTimeToClose: number;
  simPreCloseKeepEnabled: boolean;
  realPreCloseKeepEnabled: boolean;
  simPreCloseKeepBidThreshold: number;
  realPreCloseKeepBidThreshold: number;
  simAllowedMarketTags: string;
  realAllowedMarketTags: string;
  simSignalScoreSizingEnabled: boolean;
  realSignalScoreSizingEnabled: boolean;
  copyIncreaseEnabled: boolean;
  copyDecreaseEnabled: boolean;
  maxIncreasesPerPosition: number;
  preCloseEnabled: boolean;
  preCloseSeconds: number;
  killSwitchAction: string;
  slConfirmationTicks: number;
  moveDetectorIntervalMs: number;
  simInitialCapitalCopy: number;
}

export interface CryptoConfig {
  cryptoAlgoEnabled: boolean;
  cryptoAlgoRecordingEnabled: boolean;
  cryptoAlgoMaxOpenPositions: number;
  cryptoAlgoMaxExposureUsdc: number;
  cryptoAlgoMaxDailyLossUsdc: number;
  cryptoAlgoMaxPositionSizeUsdc: number;
  cryptoAlgoSlConfirmationTicks: number;
  cryptoAlgoKillSwitchAction: string;
  cryptoAlgoMinBidToAskRatio: number;
  cryptoAlgoEntryDepthRetryMax: number;
  cryptoAlgoEntryDepthRetryDelayMs: number;
  cryptoAlgoSlCloseMaxRetries: number;
  cryptoAlgoMinTimeToClose: number | null;
  cryptoAlgoAllowedMarketTags: string[];
  cryptoAlgoSignalScoreSizingEnabled: boolean;
  cryptoAlgoPriceTickCleanupEnabled: boolean;
  cryptoAlgoPriceTickCleanupIntervalMinutes: number;
  cryptoAlgoStrategies: string[];
  cryptoAlgoTrailingPercent: number | null;
  cryptoAlgoTrailingActivationPercent: number | null;
  cryptoAlgoSlEnabled: boolean;
  cryptoAlgoTpEnabled: boolean;
  cryptoAlgoTrailingEnabled: boolean;
  cryptoAlgoSlPercent: number | null;
  cryptoAlgoTpPercent: number | null;
  cryptoAlgoPreCloseEnabled: boolean | null;
  cryptoAlgoPreCloseSeconds: number | null;
  cryptoAlgoPreCloseKeepEnabled: boolean | null;
  cryptoAlgoPreCloseKeepBidThreshold: number | null;
  cryptoAlgoReentryWindowMs: number | null;
  cryptoAlgoMaxEntriesPerWindow: number | null;
  cryptoAlgoBaseThreshold: number | null;
  cryptoAlgoEntryPriceMin: number | null;
  cryptoAlgoEntryPriceMax: number | null;
  cryptoAlgoEntryPriceBandEnabled: boolean | null;
  cryptoAlgoCurveFilterEnabled: boolean | null;
  cryptoAlgoCurveLookbackMs: number | null;
  cryptoAlgoCurveMinDelta: number | null;
  cryptoAlgoSpreadAdjustmentFactor: number | null;
  cryptoAlgoMinSpreadAbsForAdjustment: number | null;
  cryptoAlgoMaxSpreadAbs: number | null;
  cryptoAlgoPriceSumTolerance: number | null;
  cryptoAlgoWarnPriceDeviation: number | null;
  cryptoAlgoMaxBookAgeMs: number | null;
  cryptoAlgoGammaCacheTtlShortMs: number | null;
  cryptoAlgoGammaCacheTtlDefaultMs: number | null;
  cryptoAlgoGammaStaleOnErrorFactor: number | null;
  cryptoAlgoWsDebounceMs: number | null;
  cryptoAlgoPollMs: number | null;
  cryptoAlgoTickIntervalMs: number | null;
  cryptoAlgoTickRetentionHours: number | null;
  cryptoAlgoPriceTickRefQty: number | null;
  cryptoAlgoMinTimeToCloseBufferSeconds: number | null;
  cryptoAlgoLastCloseableBidMaxAgeMs: number | null;
  cryptoAlgoSpreadAbsByInterval: Record<string, number> | null;
  cryptoAlgoExitDefaultsByInterval: Record<
    string,
    {
      slPercent?: number;
      tpPercent?: number;
      trailingPercent?: number;
      trailingActivationPercent?: number;
    }
  > | null;
  cryptoAlgoPreCloseSecondsByInterval: Record<string, number> | null;
  cryptoAlgoSlQuotaEnabled: boolean;
  cryptoAlgoSlQuotaPerMarket: number;
  cryptoAlgoSlQuotaCacheTtlSeconds: number;
  cryptoAlgoSizingMode: string;
  cryptoAlgoEntryUsdcAmount: number;
  cryptoAlgoEntryShareCount: number | null;
  simInitialCapitalCrypto: number;
  cryptoAlgoConfigFingerprint?: string;
}

export interface WeatherConfig {
  weatherAlgoEnabled: boolean;
  weatherAlgoSimEnabled: boolean;
  weatherAlgoRealEnabled: boolean;
  weatherAlgoMinEdge: number;
  weatherAlgoMaxForecastStd: number | null;
  weatherAlgoSizingMode: string;
  weatherAlgoEntryUsdc: number;
  weatherAlgoEntryShareCount: number;
  weatherAlgoSelectionMode: string;
  weatherAlgoMaxSignalsPerEvent: number;
  weatherAlgoForecastChangeThreshold: number;
  weatherAlgoPollMs: number;
  weatherAlgoCityFollowSwitchMode: string;
  weatherAlgoBucketHysteresisPolls: number;
  weatherAlgoReentryThrottleMs: number;
  weatherAlgoMaxOpenPositions: number;
  weatherAlgoMaxExposureUsdc: number;
  weatherAlgoMaxDailyLossUsdc: number;
  weatherAlgoMaxPositionSizeUsdc: number;
  weatherAlgoSlConfirmationTicks: number;
  weatherAlgoKillSwitchAction: string;
  weatherAlgoMinBidToAskRatio: number;
  weatherAlgoEntryDepthRetryMax: number;
  weatherAlgoEntryDepthRetryDelayMs: number;
  weatherAlgoSlCloseMaxRetries: number;
  weatherAlgoMinTimeToClose: number;
  weatherAlgoAllowedMarketTags: string[];
  weatherAlgoSignalScoreSizingEnabled: boolean;
  weatherAlgoSlEnabled: boolean;
  weatherAlgoTpEnabled: boolean;
  weatherAlgoTrailingEnabled: boolean;
  simInitialCapitalWeather: number;
  weatherAlgoForecastHistoryRecordingEnabled: boolean;
  weatherAlgoMarketSnapshotRecordingEnabled: boolean;
  weatherAlgoEvaluationLogRecordingEnabled: boolean;
  weatherAlgoForecastHistoryRetentionDays: number;
  weatherAlgoMarketSnapshotRetentionDays: number;
  weatherAlgoEvaluationLogRetentionDays: number;
  weatherAlgoStrategies: string[];
  weatherAlgoStrategyParams: Record<string, Record<string, number | boolean | string | null>>;
}

export interface WeatherStrategyMeta {
  id: string;
  label: string;
  description: string;
  supportsGroup: boolean;
  params: Array<{
    key: string;
    label: string;
    kind: 'number' | 'boolean' | 'select';
    min?: number;
    max?: number;
    step?: number;
    options?: Array<{ value: string; label: string }>;
    default: number | boolean | string;
    hint?: string;
  }>;
}

export async function fetchGlobalConfig(): Promise<GlobalConfig> {
  return api<GlobalConfig>('/config/global');
}

export async function updateGlobalConfig(data: Partial<GlobalConfig>): Promise<GlobalConfig> {
  return api<GlobalConfig>('/config/global', { method: 'PUT', body: JSON.stringify(data) });
}

export async function fetchCopyConfig(): Promise<CopyConfig> {
  return api<CopyConfig>('/config/copy');
}

export async function updateCopyConfig(data: Partial<CopyConfig>): Promise<CopyConfig> {
  return api<CopyConfig>('/config/copy', { method: 'PUT', body: JSON.stringify(data) });
}

export async function fetchCryptoConfig(): Promise<CryptoConfig> {
  return api<CryptoConfig>('/config/crypto');
}

export async function updateCryptoConfig(data: Partial<CryptoConfig>): Promise<CryptoConfig> {
  return api<CryptoConfig>('/config/crypto', { method: 'PUT', body: JSON.stringify(data) });
}

export async function fetchWeatherConfig(): Promise<WeatherConfig> {
  return api<WeatherConfig>('/config/weather');
}

export async function fetchWeatherStrategyCatalog(): Promise<{ strategies: WeatherStrategyMeta[] }> {
  return api<{ strategies: WeatherStrategyMeta[] }>('/weather-algo/strategy-catalog');
}

export async function updateWeatherConfig(data: Partial<WeatherConfig>): Promise<WeatherConfig> {
  return api<WeatherConfig>('/config/weather', { method: 'PUT', body: JSON.stringify(data) });
}

/** Compose the legacy EnvSettings view from the four isolated config tables. */
export async function fetchEnvSettings(): Promise<EnvSettings> {
  const [globalConfig, copyConfig, cryptoConfig, weatherConfig] = await Promise.all([
    fetchGlobalConfig(),
    fetchCopyConfig(),
    fetchCryptoConfig(),
    fetchWeatherConfig(),
  ]);
  return {
    ...globalConfig,
    ...copyConfig,
    ...cryptoConfig,
    ...weatherConfig,
    simInitialCapital: cryptoConfig.simInitialCapitalCrypto,
  } as unknown as EnvSettings;
}

/**
 * Dispatch an EnvSettings patch to the correct /api/config/* endpoint(s)
 * based on the key prefixes. Returns the updated global config (legacy shape).
 */
export async function updateEnvSettings(
  patch: Partial<EnvSettings>,
): Promise<EnvSettings> {
  const globalPatch: Partial<GlobalConfig> = {};
  const copyPatch: Partial<CopyConfig> = {};
  const cryptoPatch: Partial<CryptoConfig> = {};
  const weatherPatch: Partial<WeatherConfig> = {};

  for (const [key, value] of Object.entries(patch)) {
    if (key in globalConfigProxy || /^simAutoSnapshot|^realAutoSnapshot|^maxSlippagePercent|^realCashOverride|^simExec|^simSelfImpact|^simWalletPreflight|^simShadowLogging|^shadowSampleRetentionDays/.test(key)) {
      (globalPatch as Record<string, unknown>)[key] = value;
    } else if (key in copyConfigProxy || /^(sim|real)(Copy|Entry|Kelly|Risk|DefaultWin|Max|Min|Sl|Tp|Trailing|PreClose|AllowedMarketTags|SignalScore|Momentum|KillSwitch)|^slConfirmationTicks$|^moveDetectorIntervalMs$|^copyIncrease|^copyDecrease|^maxIncreases|^preCloseEnabled$|^preCloseSeconds$|^kill_switch|^simInitialCapitalCopy$/.test(key)) {
      (copyPatch as Record<string, unknown>)[key] = value;
    } else if (key in cryptoConfigProxy || /^cryptoAlgo|^simInitialCapitalCrypto$/.test(key) || key === 'simInitialCapital') {
      (cryptoPatch as Record<string, unknown>)[key] = value;
    } else if (key in weatherConfigProxy || /^weatherAlgo|^simInitialCapitalWeather$/.test(key)) {
      (weatherPatch as Record<string, unknown>)[key] = value;
    }
  }

  if (Object.keys(globalPatch).length > 0) await updateGlobalConfig(globalPatch);
  if (Object.keys(copyPatch).length > 0) await updateCopyConfig(copyPatch);
  if (Object.keys(cryptoPatch).length > 0) await updateCryptoConfig(cryptoPatch);
  if (Object.keys(weatherPatch).length > 0) await updateWeatherConfig(weatherPatch);

  return fetchEnvSettings();
}

// Empty objects used only for `in` checks at runtime to decide which config
// table a key belongs to. TypeScript narrows these to their respective types.
const globalConfigProxy = {} as GlobalConfig;
const copyConfigProxy = {} as CopyConfig;
const cryptoConfigProxy = {} as CryptoConfig;
const weatherConfigProxy = {} as WeatherConfig;
