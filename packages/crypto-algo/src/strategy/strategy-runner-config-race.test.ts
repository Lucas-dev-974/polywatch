import { describe, expect, it, vi } from 'vitest';
import type { CryptoConfig } from '@polywatch/core';
import { tryLoadCryptoReentryState } from '@polywatch/core';
import { StrategyRegistry } from './index.js';
import {
  StrategyRunner,
  shouldFailClosedOnReentryRedisLoad,
} from './strategy-runner.js';

function minimalCryptoConfig(overrides: Partial<CryptoConfig> = {}): CryptoConfig {
  return {
    cryptoAlgoEnabled: true,
    cryptoAlgoRecordingEnabled: true,
    cryptoAlgoStrategies: '["naive-momentum"]',
    cryptoAlgoGammaCacheTtlShortMs: 10_000,
    cryptoAlgoGammaCacheTtlDefaultMs: 30_000,
    cryptoAlgoReentryWindowMs: 60_000,
    cryptoAlgoMaxEntriesPerWindow: 1,
    ...overrides,
  } as CryptoConfig;
}

function createRunnerStub(reEntryWindowMs: number | null = 0): StrategyRunner {
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
    reEntryWindowMs,
  );
}

describe('strategy-runner config race', () => {
  it('applyRiskTunables replaces currentCryptoConfig atomically', () => {
    const runner = createRunnerStub();
    const configA = minimalCryptoConfig({ cryptoAlgoMaxOpenPositions: 1 });
    const configB = minimalCryptoConfig({ cryptoAlgoMaxOpenPositions: 9 });

    runner.applyRiskTunables(configA);
    const midFlightRef = (runner as unknown as { currentCryptoConfig: CryptoConfig })
      .currentCryptoConfig;
    runner.applyRiskTunables(configB);

    // Eval paths that captured midFlightRef keep configA; field points at configB.
    expect(midFlightRef).toBe(configA);
    expect((runner as unknown as { currentCryptoConfig: CryptoConfig }).currentCryptoConfig)
      .toBe(configB);
  });

  it('applyRiskTunables bumps configEpoch so mid-eval can detect drift', () => {
    const runner = createRunnerStub();
    runner.applyRiskTunables(minimalCryptoConfig({ cryptoAlgoMaxOpenPositions: 1 }));
    const epoch1 = (runner as unknown as { configEpoch: number }).configEpoch;
    runner.applyRiskTunables(minimalCryptoConfig({ cryptoAlgoMaxOpenPositions: 2 }));
    const epoch2 = (runner as unknown as { configEpoch: number }).configEpoch;
    expect(epoch2).toBe(epoch1 + 1);
  });

  it('stop sets stopping and stopAndDrain clears evalChains', async () => {
    const runner = createRunnerStub();
    runner.applyRiskTunables(minimalCryptoConfig());
    (runner as unknown as { evalChains: Map<string, Promise<boolean>> }).evalChains.set(
      'c1',
      Promise.resolve(false),
    );
    await runner.stopAndDrain(50);
    expect((runner as unknown as { stopping: boolean }).stopping).toBe(true);
    expect((runner as unknown as { evalChains: Map<string, Promise<boolean>> }).evalChains.size).toBe(
      0,
    );
  });

  it('Redis re-entry throttle is fail-closed when load fails', async () => {
    const redis = {
      get: vi.fn(async () => {
        throw new Error('redis down');
      }),
    };
    const loaded = await tryLoadCryptoReentryState(redis, '0xabc', 'YES');
    expect(loaded.ok).toBe(false);
    expect(shouldFailClosedOnReentryRedisLoad(loaded)).toBe(true);
  });

  it('does not fail-closed when Redis load succeeds', async () => {
    const redis = {
      get: vi.fn(async () => null),
    };
    const loaded = await tryLoadCryptoReentryState(redis, '0xabc', 'YES');
    expect(loaded.ok).toBe(true);
    expect(shouldFailClosedOnReentryRedisLoad(loaded)).toBe(false);
  });

  it('fetchGammaMarketCached returns null when cryptoConfig was never applied', async () => {
    const runner = createRunnerStub();
    const fetch = (
      runner as unknown as {
        fetchGammaMarketCached: (
          conditionId: string,
          now: number,
          interval?: string | null,
        ) => Promise<unknown>;
      }
    ).fetchGammaMarketCached.bind(runner);

    await expect(fetch('0xcond', Date.now(), '5m')).resolves.toBeNull();
  });
});
