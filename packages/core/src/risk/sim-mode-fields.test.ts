import { describe, expect, it } from 'vitest';
import type { GlobalConfig } from '../entities/GlobalConfig.js';
import type { CopyConfig } from '../entities/CopyConfig.js';
import type { CryptoConfig } from '../entities/CryptoConfig.js';
import {
  CRYPTO_ALGO_SNAPSHOT_KEYS,
  extractSimConfigSnapshotFromIsolated,
  extractRealConfigSnapshotFromIsolated,
  REAL_RISK_CONFIG_KEYS,
  SIM_RISK_CONFIG_KEYS,
} from '../risk/sim-mode-fields.js';

function baseGlobal(): GlobalConfig {
  return {
    id: 1,
    realTradingEnabled: false,
    maxSlippagePercent: 2,
    simAutoSnapshotEnabled: false,
    simAutoSnapshotIntervalSeconds: 3600,
    simAutoSnapshotEmptySession: false,
    simSnapshotMaxCount: 100,
    simSnapshotRetentionDays: 30,
    simSnapshotDecisionWindowHours: 48,
    simExecLatencyMode: 'fixed',
    simExecLatencyMs: 0,
    simSelfImpactEnabled: false,
    simSelfImpactTtlSeconds: 60,
    simWalletPreflightEnabled: false,
    simShadowLoggingEnabled: false,
    shadowSampleRetentionDays: 7,
    realAutoSnapshotEnabled: false,
    realAutoSnapshotIntervalSeconds: 3600,
    realSnapshotMaxCount: 100,
    realSnapshotRetentionDays: 30,
    realSnapshotDecisionWindowHours: 48,
    realCashOverride: null,
  } as GlobalConfig;
}

function baseCopy(): CopyConfig {
  return {
    id: 1,
    simSizingMode: 'fixed_usdc',
    simCopyRatio: 1,
    simEntryUsdcAmount: 10,
    simEntryShareCount: 5,
    simKellyFraction: 0.25,
    simRiskBudgetUsdc: 10,
    simDefaultWinProbability: 0.55,
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
    simTrailingPercent: 10,
    simTrailingActivationPercent: 12,
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
    slConfirmationTicks: 2,
  } as CopyConfig;
}

function baseCrypto(): CryptoConfig {
  return {
    id: 1,
    simInitialCapitalCrypto: 10000,
    cryptoAlgoEnabled: false,
    cryptoAlgoBaseThreshold: 0.55,
    cryptoAlgoSlPercent: 10,
  } as CryptoConfig;
}

describe('extractSimConfigSnapshotFromIsolated', () => {
  it('includes all sim keys and parses market tags', () => {
    const snapshot = extractSimConfigSnapshotFromIsolated(
      baseGlobal(),
      baseCopy(),
      baseCrypto(),
    );
    for (const key of SIM_RISK_CONFIG_KEYS) {
      if (key === 'simAllowedMarketTags') continue;
      const merged = { ...baseGlobal(), ...baseCopy(), ...baseCrypto() } as Record<
        string,
        unknown
      >;
      expect(snapshot[key]).toBe(merged[key]);
    }
    expect(snapshot.simAllowedMarketTags).toEqual(['politics']);
  });

  it('includes crypto algo keys without polluting SIM_RISK_CONFIG_KEYS', () => {
    const crypto = {
      ...baseCrypto(),
      cryptoAlgoEnabled: true,
      cryptoAlgoBaseThreshold: 0.55,
      cryptoAlgoSlPercent: 20,
    } as CryptoConfig;
    const snapshot = extractSimConfigSnapshotFromIsolated(baseGlobal(), baseCopy(), crypto);
    expect(snapshot.cryptoAlgoEnabled).toBe(true);
    expect(snapshot.cryptoAlgoBaseThreshold).toBe(0.55);
    expect(snapshot.cryptoAlgoSlPercent).toBe(20);
    for (const key of SIM_RISK_CONFIG_KEYS) {
      expect(key.startsWith('cryptoAlgo')).toBe(false);
    }
    for (const key of CRYPTO_ALGO_SNAPSHOT_KEYS) {
      expect(key in snapshot).toBe(true);
    }
  });
});

describe('extractRealConfigSnapshotFromIsolated', () => {
  it('includes all real keys, realCashOverride, and parses market tags', () => {
    const copy = {
      ...baseCopy(),
      realSizingMode: 'fixed_usdc',
      realCopyRatio: 0.5,
      realAllowedMarketTags: '["crypto"]',
    } as CopyConfig;
    const global = {
      ...baseGlobal(),
      realCashOverride: 250,
      realAutoSnapshotEnabled: true,
      realAutoSnapshotIntervalSeconds: 1800,
      realSnapshotMaxCount: 100,
      realSnapshotRetentionDays: 30,
      realSnapshotDecisionWindowHours: 48,
    } as GlobalConfig;

    const snapshot = extractRealConfigSnapshotFromIsolated(global, copy, baseCrypto());
    for (const key of REAL_RISK_CONFIG_KEYS) {
      if (key === 'realAllowedMarketTags') continue;
      const merged = { ...global, ...copy, ...baseCrypto() } as Record<string, unknown>;
      expect(snapshot[key]).toBe(merged[key]);
    }
    expect(snapshot.realAllowedMarketTags).toEqual(['crypto']);
    expect(snapshot.realCashOverride).toBe(250);
  });
});
