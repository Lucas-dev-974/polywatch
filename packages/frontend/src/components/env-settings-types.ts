import {
  REAL_RISK_CONFIG_KEYS,
  SIM_RISK_CONFIG_KEYS,
} from '@polywatch/core/risk/sim-mode-fields';

export type EnvMode = 'sim' | 'real';

export type SizingMode =
  | 'fixed_usdc'
  | 'fixed_shares'
  | 'fixed_ratio'
  | 'proportional_capital'
  | 'kelly_fractional'
  | 'risk_based';

export interface EnvSettings {
  simSizingMode: SizingMode;
  simCopyRatio: number;
  simEntryUsdcAmount: number;
  simEntryShareCount: number;
  simKellyFraction: number;
  simRiskBudgetUsdc: number;
  simDefaultWinProbability: number;
  /** @deprecated Alias crypto — use simInitialCapitalCrypto */
  simInitialCapital: number;
  simInitialCapitalCrypto: number;
  simInitialCapitalWeather: number;
  simInitialCapitalCopy: number;
  realSizingMode: SizingMode;
  realCopyRatio: number;
  realEntryUsdcAmount: number;
  realEntryShareCount: number;
  realKellyFraction: number;
  realRiskBudgetUsdc: number;
  realDefaultWinProbability: number;
  simMaxPositionSizeUsdc: number;
  realMaxPositionSizeUsdc: number;
  simMaxOpenPositions: number;
  realMaxOpenPositions: number;
  simMaxExposureUsdc: number;
  realMaxExposureUsdc: number;
  simMaxDailyLossUsdc: number;
  realMaxDailyLossUsdc: number;
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
  simMinBidToAskRatio: number;
  simEntryDepthRetryMax: number;
  simEntryDepthRetryDelayMs: number;
  realMinBidToAskRatio: number;
  realEntryDepthRetryMax: number;
  realEntryDepthRetryDelayMs: number;
  simMomentumFilterEnabled: boolean;
  realMomentumFilterEnabled: boolean;
  simSlEnabled: boolean;
  simTpEnabled: boolean;
  simSlBidPoints: number;
  simSlCloseMaxRetries: number;
  simTpBidPoints: number;
  simTrailingEnabled: boolean;
  simTrailingBidPoints: number;
  simTrailingActivationBidPoints: number;
  realSlEnabled: boolean;
  realTpEnabled: boolean;
  realSlBidPoints: number;
  realSlCloseMaxRetries: number;
  realTpBidPoints: number;
  realTrailingEnabled: boolean;
  realTrailingBidPoints: number;
  realTrailingActivationBidPoints: number;
  simPreCloseEnabled: boolean;
  realPreCloseEnabled: boolean;
  simPreCloseSeconds: number;
  realPreCloseSeconds: number;
  simPreCloseKeepEnabled: boolean;
  realPreCloseKeepEnabled: boolean;
  simPreCloseKeepBidThreshold: number;
  realPreCloseKeepBidThreshold: number;
  simMinTimeToClose: number;
  realMinTimeToClose: number;
  simAllowedMarketTags: string[];
  realAllowedMarketTags: string[];
  simSignalScoreSizingEnabled: boolean;
  realSignalScoreSizingEnabled: boolean;
  simAutoSnapshotEnabled: boolean;
  simAutoSnapshotIntervalSeconds: number;
  simAutoSnapshotEmptySession: boolean;
  simSnapshotMaxCount: number | null;
  simSnapshotRetentionDays: number | null;
  simSnapshotDecisionWindowHours: number;
  realAutoSnapshotEnabled: boolean;
  realAutoSnapshotIntervalSeconds: number;
  realSnapshotMaxCount: number | null;
  realSnapshotRetentionDays: number | null;
  realSnapshotDecisionWindowHours: number;
  realCashOverride: number | null;
  cryptoAlgoEnabled: boolean;
  cryptoAlgoPriceTickCleanupEnabled: boolean;
  cryptoAlgoPriceTickCleanupIntervalMinutes: number;
  cryptoAlgoStrategies: string[];
  cryptoAlgoTrailingBidPoints: number | null;
  cryptoAlgoTrailingActivationBidPoints: number | null;
  cryptoAlgoSlEnabled: boolean;
  cryptoAlgoTpEnabled: boolean;
  cryptoAlgoTrailingEnabled: boolean;
  cryptoAlgoSlBidPoints: number | null;
  cryptoAlgoTpBidPoints: number | null;
  cryptoAlgoPreCloseEnabled: boolean | null;
  cryptoAlgoPreCloseSeconds: number | null;
  cryptoAlgoPreCloseKeepEnabled: boolean | null;
  cryptoAlgoPreCloseKeepBidThreshold: number | null;
  cryptoAlgoMinTimeToClose: number | null;
  cryptoAlgoReentryWindowMs: number | null;
  cryptoAlgoMaxEntriesPerWindow: number | null;
  cryptoAlgoSlQuotaEnabled: boolean;
  cryptoAlgoSlQuotaPerMarket: number | null;
  cryptoAlgoSlQuotaCacheTtlSeconds: number | null;
  slConfirmationTicks: number;
  cryptoAlgoSizingMode: string;
  cryptoAlgoEntryUsdcAmount: number;
  cryptoAlgoEntryShareCount: number | null;
  simExecLatencyMode: string | null;
  simExecLatencyMs: number | null;
  simSelfImpactEnabled: boolean | null;
  simSelfImpactTtlSeconds: number | null;
  simWalletPreflightEnabled: boolean | null;
  simShadowLoggingEnabled: boolean | null;
  shadowSampleRetentionDays: number | null;
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
      slBidPoints?: number;
      tpBidPoints?: number;
      trailingBidPoints?: number;
      trailingActivationBidPoints?: number;
    }
  > | null;
  cryptoAlgoPreCloseSecondsByInterval: Record<string, number> | null;
  /** Global slippage guard for entries (copy + crypto algo, sim + real). */
  maxSlippagePercent: number;
}

const SIM_FIELDS = [...SIM_RISK_CONFIG_KEYS] as const satisfies readonly (keyof EnvSettings)[];

const REAL_FIELDS = [...REAL_RISK_CONFIG_KEYS] as const satisfies readonly (keyof EnvSettings)[];

export function pickModeFields(
  config: EnvSettings,
  mode: EnvMode,
): Partial<EnvSettings> {
  const fields = mode === 'sim' ? SIM_FIELDS : REAL_FIELDS;
  return Object.fromEntries(
    fields.map((key) => [key, config[key]]),
  ) as Partial<EnvSettings>;
}

export const ENV_MODE_LABELS: Record<EnvMode, string> = {
  sim: 'Simulation',
  real: 'Réel',
};

export function modeSettingKey<S extends string>(
  mode: EnvMode,
  suffix: S,
): `${EnvMode}${S}` & keyof EnvSettings {
  return `${mode}${suffix}` as `${EnvMode}${S}` & keyof EnvSettings;
}
