import { describe, expect, it } from 'vitest';
import type { RiskConfig } from '../entities/RiskConfig.js';
import { backfillLegacyRiskConfig } from './risk-config-backfill.js';

function baseConfig(overrides: Partial<RiskConfig> = {}): RiskConfig {
  return {
    id: 1,
    simMaxOpenPositions: 10,
    realMaxOpenPositions: 10,
    maxExposureUsdc: 1000,
    maxDailyLossUsdc: 100,
    maxPositionSizeUsdc: 200,
    maxSlippagePercent: 2,
    simMinBidToAskRatio: 0.9,
    realMinBidToAskRatio: 0.9,
    simMomentumFilterEnabled: false,
    realMomentumFilterEnabled: false,
    exitSlippageGuardPercent: 50,
    preCloseEnabled: true,
    killSwitchAction: 'block_entries',
    realTradingEnabled: false,
    simCopyTradingEnabled: true,
    realCopyTradingEnabled: true,
    simSizingMode: 'fixed_usdc',
    simCopyRatio: 1,
    simEntryUsdcAmount: 10,
    simKellyFraction: 0.25,
    simRiskBudgetUsdc: 10,
    simDefaultWinProbability: 0.55,
    simInitialCapital: 10_000,
    realSizingMode: 'fixed_usdc',
    realCopyRatio: 1,
    realEntryUsdcAmount: 10,
    realKellyFraction: 0.25,
    realRiskBudgetUsdc: 10,
    realDefaultWinProbability: 0.55,
    simSlCloseMaxRetries: 5,
    simTrailingEnabled: true,
    simTrailingBidPoints: 0.1,
    simTrailingActivationBidPoints: 0,
    realSlCloseMaxRetries: 5,
    realTrailingEnabled: true,
    realTrailingBidPoints: 0.1,
    realTrailingActivationBidPoints: 0,
    simSlEnabled: true,
    simTpEnabled: true,
    realSlEnabled: true,
    realTpEnabled: true,
    simSlBidPoints: 0.10,
    simTpBidPoints: 0.12,
    realSlBidPoints: 0.10,
    realTpBidPoints: 0.12,
    copyIncreaseEnabled: true,
    copyDecreaseEnabled: true,
    maxIncreasesPerPosition: 0,
    simMaxPositionSizeUsdc: 200,
    realMaxPositionSizeUsdc: 200,
    simMaxExposureUsdc: 1000,
    realMaxExposureUsdc: 1000,
    simMaxDailyLossUsdc: 100,
    realMaxDailyLossUsdc: 100,
    simKillSwitchAction: 'block_entries',
    realKillSwitchAction: 'block_entries',
    simCopyIncreaseEnabled: true,
    realCopyIncreaseEnabled: true,
    simCopyDecreaseEnabled: true,
    realCopyDecreaseEnabled: true,
    simMaxIncreasesPerPosition: 0,
    realMaxIncreasesPerPosition: 0,
    simCopyIncreaseSlProximityEnabled: false,
    realCopyIncreaseSlProximityEnabled: false,
    simCopyIncreaseSlProximityPercent: 80,
    realCopyIncreaseSlProximityPercent: 80,
    simPreCloseEnabled: true,
    realPreCloseEnabled: true,
    simPreCloseSeconds: 60,
    realPreCloseSeconds: 60,
    simMinTimeToClose: 0,
    realMinTimeToClose: 0,
    simPreCloseKeepEnabled: false,
    simPreCloseKeepBidThreshold: 0.80,
    realPreCloseKeepEnabled: false,
    realPreCloseKeepBidThreshold: 0.80,
    simAllowedMarketTags: '[]',
    realAllowedMarketTags: '[]',
    simSignalScoreSizingEnabled: true,
    realSignalScoreSizingEnabled: true,
    simAutoSnapshotEnabled: false,
    simAutoSnapshotIntervalSeconds: 3600,
    simSnapshotMaxCount: null,
    simSnapshotRetentionDays: null,
    moveDetectorIntervalMs: 2_000,
    cryptoAlgoEnabled: false,
    cryptoAlgoPriceTickCleanupEnabled: true,
    cryptoAlgoPriceTickCleanupIntervalMinutes: 60,
    cryptoAlgoStrategies: '["naive-momentum"]',
    cryptoAlgoSlEnabled: true,
    cryptoAlgoTpEnabled: true,
    cryptoAlgoTrailingEnabled: true,
    cryptoAlgoTrailingBidPoints: null,
    cryptoAlgoTrailingActivationBidPoints: null,
    cryptoAlgoPreCloseEnabled: null,
    cryptoAlgoPreCloseSeconds: null,
    cryptoAlgoPreCloseKeepEnabled: null,
    cryptoAlgoPreCloseKeepBidThreshold: null,
    cryptoAlgoMinTimeToClose: null,
    cryptoAlgoSlBidPoints: null,
    cryptoAlgoTpBidPoints: null,
    cryptoAlgoReentryWindowMs: null,
    cryptoAlgoMaxEntriesPerWindow: null,
    cryptoAlgoBaseThreshold: null,
    cryptoAlgoSpreadAdjustmentFactor: null,
    cryptoAlgoMinSpreadAbsForAdjustment: null,
    cryptoAlgoMaxSpreadAbs: null,
    cryptoAlgoPriceSumTolerance: null,
    cryptoAlgoWarnPriceDeviation: null,
    cryptoAlgoMaxBookAgeMs: null,
    cryptoAlgoGammaCacheTtlShortMs: null,
    cryptoAlgoGammaCacheTtlDefaultMs: null,
    cryptoAlgoGammaStaleOnErrorFactor: null,
    cryptoAlgoWsDebounceMs: null,
    cryptoAlgoPollMs: null,
    cryptoAlgoTickIntervalMs: null,
    cryptoAlgoTickRetentionHours: null,
    cryptoAlgoPriceTickRefQty: null,
    cryptoAlgoMinTimeToCloseBufferSeconds: null,
    cryptoAlgoLastCloseableBidMaxAgeMs: null,
    cryptoAlgoSpreadAbsByInterval: null,
    cryptoAlgoExitDefaultsByInterval: null,
    cryptoAlgoPreCloseSecondsByInterval: null,
    realCashOverride: null,
    slConfirmationTicks: 2,
    cryptoAlgoSizingMode: 'fixed_usdc',
    cryptoAlgoEntryUsdcAmount: 10,
    cryptoAlgoEntryShareCount: null,
    ...overrides,
  } as RiskConfig;
}

describe('backfillLegacyRiskConfig', () => {
  it('copies customized legacy position size to both modes', () => {
    const config = baseConfig({
      maxPositionSizeUsdc: 500,
      simMaxPositionSizeUsdc: 200,
      realMaxPositionSizeUsdc: 200,
    });

    expect(backfillLegacyRiskConfig(config)).toBe(true);
    expect(config.simMaxPositionSizeUsdc).toBe(500);
    expect(config.realMaxPositionSizeUsdc).toBe(500);
  });

  it('copies customized kill switch only when legacy differs from default', () => {
    const config = baseConfig({
      killSwitchAction: 'force_close_all',
      simKillSwitchAction: 'block_entries',
      realKillSwitchAction: 'block_entries',
    });

    expect(backfillLegacyRiskConfig(config)).toBe(true);
    expect(config.simKillSwitchAction).toBe('force_close_all');
    expect(config.realKillSwitchAction).toBe('force_close_all');
  });

  it('skips backfill when mode-specific values were already customized', () => {
    const config = baseConfig({
      maxPositionSizeUsdc: 500,
      simMaxPositionSizeUsdc: 300,
      realMaxPositionSizeUsdc: 200,
    });

    expect(backfillLegacyRiskConfig(config)).toBe(false);
    expect(config.simMaxPositionSizeUsdc).toBe(300);
  });
});
