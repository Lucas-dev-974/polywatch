import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CopyConfig } from '../entities/CopyConfig.js';
import type { CryptoConfig } from '../entities/CryptoConfig.js';
import type { GlobalConfig } from '../entities/GlobalConfig.js';
import type { RiskConfig } from '../entities/RiskConfig.js';
import type { WeatherConfig } from '../entities/WeatherConfig.js';
import { initializeDataSource } from '../database/data-source.js';
import { createTestDataSource } from '../database/test-data-source.js';
import { seedDefaults } from '../seed/defaults.js';
import { RiskService } from '../services/risk.service.js';
import { SystemConfigService } from '../services/system-config.service.js';
import {
  RiskConfigDivergenceError,
  RiskConfigLegacyFacadeDisabledError,
  detectRiskConfigDivergences,
  handleRiskConfigDivergence,
} from './risk-config-divergence.js';

function baseIsolated(): {
  global: GlobalConfig;
  copy: CopyConfig;
  crypto: CryptoConfig;
  weather: WeatherConfig;
} {
  const global = {
    realTradingEnabled: false,
    maxSlippagePercent: 1,
    simExecLatencyMode: 'off',
    simAutoSnapshotEnabled: true,
    realAutoSnapshotEnabled: false,
  } as GlobalConfig;
  const copy = {
    simCopyTradingEnabled: true,
    realCopyTradingEnabled: false,
    simMaxOpenPositions: 5,
    realMaxOpenPositions: 3,
    simMaxDailyLossUsdc: 100,
    realMaxDailyLossUsdc: 50,
    simKillSwitchAction: 'block_entries',
    realKillSwitchAction: 'block_entries',
  } as CopyConfig;
  const crypto = {
    cryptoAlgoEnabled: true,
    cryptoAlgoMaxOpenPositions: 2,
    cryptoAlgoMaxDailyLossUsdc: 200,
    cryptoAlgoKillSwitchAction: 'block_entries',
    cryptoAlgoReentryWindowMs: 60_000,
    cryptoAlgoMaxEntriesPerWindow: 1,
  } as CryptoConfig;
  const weather = {
    weatherAlgoEnabled: false,
    weatherAlgoSimEnabled: false,
    weatherAlgoRealEnabled: false,
    weatherAlgoMaxOpenPositions: 1,
    weatherAlgoMaxDailyLossUsdc: 75,
    weatherAlgoKillSwitchAction: 'block_entries',
  } as WeatherConfig;
  return { global, copy, crypto, weather };
}

function composeLikeRiskService(
  global: GlobalConfig,
  copy: CopyConfig,
  crypto: CryptoConfig,
  weather: WeatherConfig,
): RiskConfig {
  return {
    ...global,
    ...copy,
    ...crypto,
    ...weather,
    id: 0,
  } as unknown as RiskConfig;
}

describe('risk-config-divergence', () => {
  it('detects no divergence when composed matches isolated tables', () => {
    const { global, copy, crypto, weather } = baseIsolated();
    const composed = composeLikeRiskService(global, copy, crypto, weather);
    expect(detectRiskConfigDivergences(composed, global, copy, crypto, weather)).toEqual([]);
  });

  it('detects divergence when a critical copy field differs', () => {
    const { global, copy, crypto, weather } = baseIsolated();
    const composed = composeLikeRiskService(global, copy, crypto, weather);
    composed.simMaxOpenPositions = 999;
    const divergences = detectRiskConfigDivergences(composed, global, copy, crypto, weather);
    expect(divergences).toContain('simMaxOpenPositions');
  });

  it('throws in strict mode when divergence is present', () => {
    const warn = vi.fn();
    const error = vi.fn();
    expect(() =>
      handleRiskConfigDivergence(['simMaxOpenPositions'], true, { warn, error }),
    ).toThrow(RiskConfigDivergenceError);
    expect(error).toHaveBeenCalledWith(
      { divergences: ['simMaxOpenPositions'] },
      'RiskConfig facade divergence detected — blocking',
    );
    expect(warn).not.toHaveBeenCalled();
  });

  it('logs warn without throw in log-only mode (default)', () => {
    const warn = vi.fn();
    const error = vi.fn();
    expect(() =>
      handleRiskConfigDivergence(['cryptoAlgoEnabled'], false, { warn, error }),
    ).not.toThrow();
    expect(warn).toHaveBeenCalledWith(
      { divergences: ['cryptoAlgoEnabled'] },
      'RiskConfig facade divergence detected — non-blocking',
    );
    expect(error).not.toHaveBeenCalled();
  });
});

describe('RiskService divergence guard', () => {
  let ds: Awaited<ReturnType<typeof initializeDataSource>>;

  beforeEach(async () => {
    ds = await initializeDataSource(createTestDataSource());
    RiskService.invalidateConfigCache();
    SystemConfigService.invalidateCache();
    // Shared test DB: reset Strangler flag before seedDefaults (may call getConfig).
    await new SystemConfigService(ds).set('feature.risk_config_legacy_facade', 'true');
    SystemConfigService.invalidateCache();
    await seedDefaults(ds);
    RiskService.invalidateConfigCache();
    SystemConfigService.invalidateCache();
  });

  afterEach(async () => {
    await new SystemConfigService(ds).set('feature.risk_config_legacy_facade', 'true').catch(() => {});
    SystemConfigService.invalidateCache();
    RiskService.invalidateConfigCache();
    await ds.destroy();
  });

  it('getConfig does not throw when isolated tables are consistent', async () => {
    const risk = new RiskService(ds);
    await expect(risk.getConfig()).resolves.toBeDefined();
  });

  it('getConfig throws when feature.risk_config_legacy_facade is false', async () => {
    const sys = new SystemConfigService(ds);
    await sys.set('feature.risk_config_legacy_facade', 'false');
    SystemConfigService.invalidateCache();
    RiskService.invalidateConfigCache();

    const risk = new RiskService(ds);
    await expect(risk.getConfig()).rejects.toThrow(RiskConfigLegacyFacadeDisabledError);
  });

  it('isolated getters still work when legacy facade is disabled', async () => {
    const sys = new SystemConfigService(ds);
    await sys.set('feature.risk_config_legacy_facade', 'false');
    SystemConfigService.invalidateCache();
    RiskService.invalidateConfigCache();

    const risk = new RiskService(ds);
    await expect(risk.getCryptoConfig()).resolves.toBeDefined();
    await expect(risk.getGlobalConfig()).resolves.toBeDefined();
  });

  it('getConfig fail-opens when feature flag read throws', async () => {
    const spy = vi
      .spyOn(SystemConfigService.prototype, 'getFeatureFlag')
      .mockRejectedValue(new Error('db down'));
    try {
      const risk = new RiskService(ds);
      RiskService.invalidateConfigCache();
      await expect(risk.getConfig()).resolves.toBeDefined();
    } finally {
      spy.mockRestore();
    }
  });
});
