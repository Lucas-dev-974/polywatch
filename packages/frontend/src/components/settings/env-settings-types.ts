import {
  REAL_RISK_CONFIG_KEYS,
  SIM_RISK_CONFIG_KEYS,
} from '@polywatch/core/risk/sim-mode-fields';

export type EnvMode = 'sim' | 'real';

export type SizingMode =
  | 'fixed_pusd'
  | 'fixed_shares'
  | 'fixed_ratio'
  | 'proportional_capital'
  | 'kelly_fractional'
  | 'risk_based';

export interface EnvSettings {
  simSizingMode: SizingMode;
  simCopyRatio: number;
  simEntryPusdAmount: number;
  simEntryShareCount: number;
  simKellyFraction: number;
  simRiskBudgetPusd: number;
  simDefaultWinProbability: number;
  /** @deprecated Alias crypto — use simInitialCapitalCrypto */
  simInitialCapital: number;
  simInitialCapitalCrypto: number;
  simInitialCapitalWeather: number;
  simInitialCapitalCopy: number;
  realSizingMode: SizingMode;
  realCopyRatio: number;
  realEntryPusdAmount: number;
  realEntryShareCount: number;
  realKellyFraction: number;
  realRiskBudgetPusd: number;
  realDefaultWinProbability: number;
  simMaxPositionSizePusd: number;
  realMaxPositionSizePusd: number;
  simMaxOpenPositions: number;
  realMaxOpenPositions: number;
  simMaxExposurePusd: number;
  realMaxExposurePusd: number;
  simMaxDailyLossPusd: number;
  realMaxDailyLossPusd: number;
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
  simSlPercent: number;
  simSlCloseMaxRetries: number;
  simTpPercent: number;
  simTrailingEnabled: boolean;
  simTrailingPercent: number;
  simTrailingActivationPercent: number;
  realSlEnabled: boolean;
  realTpEnabled: boolean;
  realSlPercent: number;
  realSlCloseMaxRetries: number;
  realTpPercent: number;
  realTrailingEnabled: boolean;
  realTrailingPercent: number;
  realTrailingActivationPercent: number;
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
  cryptoAlgoRecordingEnabled: boolean;
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
  cryptoAlgoMinTimeToClose: number | null;
  cryptoAlgoReentryWindowMs: number | null;
  cryptoAlgoMaxEntriesPerWindow: number | null;
  cryptoAlgoSlQuotaEnabled: boolean;
  cryptoAlgoSlQuotaPerMarket: number | null;
  cryptoAlgoSlQuotaCacheTtlSeconds: number | null;
  slConfirmationTicks: number;
  cryptoAlgoSizingMode: string;
  cryptoAlgoEntryPusdAmount: number;
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
      slPercent?: number;
      tpPercent?: number;
      trailingPercent?: number;
      trailingActivationPercent?: number;
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
