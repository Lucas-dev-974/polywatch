import { describe, expect, it, vi } from 'vitest';
import type { CryptoConfig } from '@polywatch/core';
import { tryLoadCryptoReentryState } from '@polywatch/core';
import { StrategyRegistry } from './index.js';
import { StrategyRunner } from './strategy-runner.js';

function minimalCryptoConfig(overrides: Partial<CryptoConfig> = {}): CryptoConfig {
  return {
    cryptoAlgoEnabled: true,
    cryptoAlgoStrategies: '["naive-momentum"]',
    cryptoAlgoGammaCacheTtlShortMs: 10_000,
    cryptoAlgoGammaCacheTtlDefaultMs: 30_000,
    cryptoAlgoReentryWindowMs: 60_000,
    cryptoAlgoMaxEntriesPerWindow: 1,
    ...overrides,
  } as CryptoConfig;
}

function createRunnerStub(): StrategyRunner {
  const registry = new StrategyRegistry();
  return new StrategyRunner(
    { getActiveSelections: () => [] } as never,
    registry,
    { getConfig: vi.fn() } as never,
    {} as never,
    {} as never,
    {} as never,
    async () => false,
    'https://gamma.example',
    0,
  );
}

describe('strategy-runner config race', () => {
  it('applyRiskTunables replaces currentCryptoConfig atomically', () => {
    const runner = createRunnerStub();
    const configA = minimalCryptoConfig({ cryptoAlgoMaxOpenPositions: 1 });
    const configB = minimalCryptoConfig({ cryptoAlgoMaxOpenPositions: 9 });

    runner.applyRiskTunables(configA);
    runner.applyRiskTunables(configB);

    expect((runner as unknown as { currentCryptoConfig: CryptoConfig }).currentCryptoConfig)
      .toBe(configB);
  });

  it('stop clears evaluation timers without throwing', () => {
    const runner = createRunnerStub();
    runner.applyRiskTunables(minimalCryptoConfig());
    runner.start(50);
    expect(() => runner.stop()).not.toThrow();
    runner.stopJanitor();
  });

  it('Redis re-entry throttle is fail-closed when load fails', async () => {
    const redis = {
      get: vi.fn(async () => {
        throw new Error('redis down');
      }),
    };
    const loaded = await tryLoadCryptoReentryState(redis, '0xabc', 'YES');
    expect(loaded.ok).toBe(false);
    if (!loaded.ok) {
      expect(loaded.error).toBeInstanceOf(Error);
    }
  });
});
