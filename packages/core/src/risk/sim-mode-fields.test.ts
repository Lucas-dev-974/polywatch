import { describe, expect, it } from 'vitest';
import type { RiskConfig } from '../entities/RiskConfig.js';
import type { GlobalConfig } from '../entities/GlobalConfig.js';
import type { CopyConfig } from '../entities/CopyConfig.js';
import type { CryptoConfig } from '../entities/CryptoConfig.js';
import {
  CRYPTO_ALGO_SNAPSHOT_KEYS,
  extractSimConfigSnapshot,
  extractSimConfigSnapshotFromIsolated,
  extractRealConfigSnapshot,
  extractRealConfigSnapshotFromIsolated,
  REAL_RISK_CONFIG_KEYS,
  SIM_RISK_CONFIG_KEYS,
  realRotationChanged,
  realRotationChangedFromIsolated,
} from '../risk/sim-mode-fields.js';

function baseRiskConfig(): RiskConfig {
  return {
    id: 1,
    simSizingMode: 'fixed_usdc',
    simCopyRatio: 1,
    simEntryUsdcAmount: 10,
    simEntryShareCount: 5,
    simKellyFraction: 0.25,
    simRiskBudgetUsdc: 10,
    simDefaultWinProbability: 0.55,
    simInitialCapital: 10000,
    simInitialCapitalCrypto: 10000,
    simInitialCapitalWeather: 10000,
    simInitialCapitalCopy: 10000,
    simMaxPositionSizeUsdc: 200,
    simCopyIncreaseEnabled: true,
    simCopyDecreaseEnabled: true,
    simMaxIncreasesPerPosition: 0,
    simMinBidToAskRatio: 0.9,
    simEntryDepthRetryMax: 3,
    simEntryDepthRetryDelayMs: 1000,
    simMomentumFilterEnabled: false,
    simSlEnabled: true,
    simTpEnabled: true,
    simSlCloseMaxRetries: 5,
    simTrailingEnabled: true,
    simTrailingBidPoints: 0.1,
    simTrailingActivationBidPoints: 0,
    simPreCloseEnabled: true,
    simPreCloseSeconds: 60,
    simPreCloseKeepEnabled: false,
    simPreCloseKeepBidThreshold: 0.80,
    simMinTimeToClose: 0,
    simMaxOpenPositions: 10,
    simMaxExposureUsdc: 1000,
    simMaxDailyLossUsdc: 100,
    simKillSwitchAction: 'block_entries',
    simAllowedMarketTags: '["politics"]',
    simSignalScoreSizingEnabled: true,
    simAutoSnapshotEnabled: false,
    simAutoSnapshotIntervalSeconds: 3600,
  } as RiskConfig;
}

describe('extractSimConfigSnapshot', () => {
  it('includes all sim keys and parses market tags', () => {
    const snapshot = extractSimConfigSnapshot(baseRiskConfig());
    for (const key of SIM_RISK_CONFIG_KEYS) {
      if (key === 'simAllowedMarketTags') continue;
      expect(snapshot[key]).toBe(baseRiskConfig()[key]);
    }
    expect(snapshot.simAllowedMarketTags).toEqual(['politics']);
  });

  it('includes crypto algo keys without polluting SIM_RISK_CONFIG_KEYS', () => {
    const config = {
      ...baseRiskConfig(),
      cryptoAlgoEnabled: true,
      cryptoAlgoBaseThreshold: 0.55,
      cryptoAlgoSlBidPoints: 0.1,
    } as RiskConfig;
    const snapshot = extractSimConfigSnapshot(config);
    expect(snapshot.cryptoAlgoEnabled).toBe(true);
    expect(snapshot.cryptoAlgoBaseThreshold).toBe(0.55);
    expect(snapshot.cryptoAlgoSlBidPoints).toBe(0.1);
    for (const key of SIM_RISK_CONFIG_KEYS) {
      expect(key.startsWith('cryptoAlgo')).toBe(false);
    }
    for (const key of CRYPTO_ALGO_SNAPSHOT_KEYS) {
      expect(key in snapshot).toBe(true);
    }
  });
});

describe('extractRealConfigSnapshot', () => {
  it('includes all real keys, realCashOverride, and parses market tags', () => {
    const config = {
      ...baseRiskConfig(),
      realSizingMode: 'fixed_usdc',
      realCopyRatio: 0.5,
      realAllowedMarketTags: '["crypto"]',
      realCashOverride: 250,
      realAutoSnapshotEnabled: true,
      realAutoSnapshotIntervalSeconds: 1800,
      realSnapshotMaxCount: 100,
      realSnapshotRetentionDays: 30,
      realSnapshotDecisionWindowHours: 48,
    } as RiskConfig;

    const snapshot = extractRealConfigSnapshot(config);
    for (const key of REAL_RISK_CONFIG_KEYS) {
      if (key === 'realAllowedMarketTags') continue;
      expect(snapshot[key]).toBe(config[key]);
    }
    expect(snapshot.realAllowedMarketTags).toEqual(['crypto']);
    expect(snapshot.realCashOverride).toBe(250);
  });
});

describe('extract*FromIsolated parity', () => {
  it('matches extractSimConfigSnapshot for the same field values', () => {
    const composed = {
      ...baseRiskConfig(),
      cryptoAlgoEnabled: true,
      cryptoAlgoBaseThreshold: 0.55,
      cryptoAlgoSlBidPoints: 0.1,
    } as RiskConfig;
    const fromIsolated = extractSimConfigSnapshotFromIsolated(
      composed as unknown as GlobalConfig,
      composed as unknown as CopyConfig,
      composed as unknown as CryptoConfig,
    );
    expect(fromIsolated).toEqual(extractSimConfigSnapshot(composed));
  });

  it('matches extractRealConfigSnapshot for the same field values', () => {
    const composed = {
      ...baseRiskConfig(),
      realSizingMode: 'fixed_usdc',
      realCopyRatio: 0.5,
      realAllowedMarketTags: '["crypto"]',
      realCashOverride: 250,
      cryptoAlgoEnabled: false,
    } as RiskConfig;
    const fromIsolated = extractRealConfigSnapshotFromIsolated(
      composed as unknown as GlobalConfig,
      composed as unknown as CopyConfig,
      composed as unknown as CryptoConfig,
    );
    expect(fromIsolated).toEqual(extractRealConfigSnapshot(composed));
  });

  it('realRotationChangedFromIsolated matches realRotationChanged', () => {
    const before = {
      ...baseRiskConfig(),
      realSizingMode: 'fixed_usdc',
      realCopyRatio: 0.5,
      cryptoAlgoEnabled: true,
    } as RiskConfig;
    const after = { ...before, realCopyRatio: 0.8 } as RiskConfig;
    const bundle = (cfg: RiskConfig) => ({
      global: cfg as unknown as GlobalConfig,
      copy: cfg as unknown as CopyConfig,
      crypto: cfg as unknown as CryptoConfig,
    });
    expect(realRotationChangedFromIsolated(bundle(before), bundle(after))).toBe(
      realRotationChanged(before, after),
    );
    expect(realRotationChangedFromIsolated(bundle(before), bundle(before))).toBe(false);
  });
});
