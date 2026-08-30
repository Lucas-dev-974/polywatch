import { describe, expect, it, vi } from 'vitest';
import type { WeatherConfig, MarketListItemDto } from '@polywatch/core';
import { WeatherStrategyRunner, mergeBucketsForSnapshot } from './strategy-runner.js';
import type { WeatherStrategyRegistry } from './registry.js';
import type { WeatherExitEvaluator } from '../processors/weather-exit-evaluator.js';
import type { WeatherSignal, WeatherStrategy } from './strategy.js';
import { pickBestEdgeBucket, bucketCentre } from './bucket-selection.js';
import { dedupSignalsByCityDate, applySelectionMode } from './strategy-runner-selection.js';

// Neutralise the Gamma discovery HTTP fetch for the full-cycle safe-reload test.
vi.mock('@polywatch/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@polywatch/core')>();
  const today = new Date();
  const monthDay = today.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
  const market = {
    conditionId: 'm-33',
    question: `Will the highest temperature in Paris be 33°C on ${monthDay}?`,
    eventSlug: 'paris-aug-2',
    tokenIdYes: 'yes-1',
    tokenIdNo: 'no-1',
    outcomePrices: [
      { outcome: 'Yes', price: 0.05 },
      { outcome: 'No', price: 0.95 },
    ],
    endDate: new Date(Date.now() + 48 * 3_600_000).toISOString(),
    closed: false,
    acceptingOrders: true,
  };
  return {
    ...actual,
    discoverWeatherMarkets: vi.fn(async () => ({
      temperatureMarkets: [market],
      allWeatherMarkets: [market],
      byCity: [],
    })),
    discoverResolvedWeatherMarkets: vi.fn(async () => ({
      resolvedTemperatureMarkets: [],
    })),
  };
});

function minimalRisk(overrides: Partial<WeatherConfig> = {}): WeatherConfig {
  return {
    weatherAlgoEnabled: false,
    weatherAlgoPollMs: 60_000,
    weatherAlgoMinEdge: 0.1,
    weatherAlgoMaxForecastStd: null,
    ...overrides,
  } as WeatherConfig;
}

function buildRunner(exitEvaluator: WeatherExitEvaluator) {
  const registry = {
    getAll: () => [],
    getOrdered: () => [],
  } as unknown as WeatherStrategyRegistry;

  return new WeatherStrategyRunner({
    ds: {
      getRepository: () => ({
        find: async () => [],
      }),
    } as never,
    autoTrackService: {
      listEnabled: async () => [],
    } as never,
    forecastService: {} as never,
    registrySim: registry,
    registryReal: registry,
    redisCmd: {} as never,
    onSignal: async () => false,
    pollMs: 60_000,
    exitEvaluator,
  });
}

describe('WeatherStrategyRunner setRiskConfig propagation', () => {
  it('calls setRiskConfig on each registered strategy of both registries', () => {
    const setRiskConfigSim = vi.fn();
    const setRiskConfigReal = vi.fn();
    const strategySim = {
      id: 'mock-strategy',
      evaluate: vi.fn(),
      setRiskConfig: setRiskConfigSim,
    } as unknown as WeatherStrategy;
    const strategyReal = {
      id: 'mock-strategy',
      evaluate: vi.fn(),
      setRiskConfig: setRiskConfigReal,
    } as unknown as WeatherStrategy;
    const registrySim = {
      getAll: () => [strategySim],
    } as unknown as WeatherStrategyRegistry;
    const registryReal = {
      getAll: () => [strategyReal],
    } as unknown as WeatherStrategyRegistry;

    const runner = new WeatherStrategyRunner({
      ds: { getRepository: () => ({ find: async () => [] }) } as never,
      autoTrackService: { listEnabled: async () => [] } as never,
      forecastService: {} as never,
      registrySim,
      registryReal,
      redisCmd: {} as never,
      onSignal: async () => false,
      pollMs: 60_000,
    });

    const risk = minimalRisk({ weatherAlgoMinEdge: 0.25, weatherAlgoMaxForecastStd: 1.2 });
    runner.setRiskConfig(risk);

    // One call per registry instance (sim + real), same unknown strategy id
    // falls back to catalogue defaults (weather-forecast bag has default minEdge 0.1).
    expect(setRiskConfigSim).toHaveBeenCalledTimes(1);
    expect(setRiskConfigReal).toHaveBeenCalledTimes(1);
    const bag = setRiskConfigSim.mock.calls[0][0] as { minEdge: number };
    expect(bag.minEdge).toBe(0.1);
  });

  it('does not throw when a strategy does not implement setRiskConfig', () => {
    const strategy = {
      id: 'no-setconfig-strategy',
      evaluate: vi.fn(),
    } as unknown as WeatherStrategy;
    const registrySim = {
      getAll: () => [strategy],
    } as unknown as WeatherStrategyRegistry;
    const registryReal = {
      getAll: () => [strategy],
    } as unknown as WeatherStrategyRegistry;

    const runner = new WeatherStrategyRunner({
      ds: { getRepository: () => ({ find: async () => [] }) } as never,
      autoTrackService: { listEnabled: async () => [] } as never,
      forecastService: {} as never,
      registrySim,
      registryReal,
      redisCmd: {} as never,
      onSignal: async () => false,
      pollMs: 60_000,
    });

    expect(() => runner.setRiskConfig(minimalRisk())).not.toThrow();
  });
});

describe('WeatherStrategyRunner requestEvaluationCycle', () => {
  it('drains a single pendingRerun after an overlapping request', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;

    const exitEvaluator = {
      evaluateOpenPositions: vi.fn(async () => {
        calls += 1;
        if (calls === 1) await gate;
      }),
      updateRiskConfig: vi.fn(),
    } as unknown as WeatherExitEvaluator;

    const runner = buildRunner(exitEvaluator);
    runner.setRiskConfig(minimalRisk());

    runner.requestEvaluationCycle();
    // Allow the first cycle to set cycleRunning and hit the gate
    await Promise.resolve();
    await Promise.resolve();
    expect(calls).toBe(1);

    runner.requestEvaluationCycle(); // overlap → pendingRerun
    expect(calls).toBe(1);

    release();
    await vi.waitFor(() => expect(calls).toBe(2));
  });

  it('runs a boot exit pass but defers the first full cycle to the next UTC-aligned slot', () => {
    const exitEvaluator = {
      evaluateOpenPositions: vi.fn(async () => undefined),
      updateRiskConfig: vi.fn(),
    } as unknown as WeatherExitEvaluator;

    const runner = buildRunner(exitEvaluator);
    runner.setRiskConfig(minimalRisk({ weatherAlgoPollMs: 60_000 }));
    runner.start();

    // Boot exit pass runs immediately (recovery of open positions).
    expect(exitEvaluator.evaluateOpenPositions).toHaveBeenCalledTimes(1);
    // But no full cycle is forced — the next one is grid-aligned.
    expect((runner as unknown as { timer: NodeJS.Timeout | null }).timer).not.toBeNull();

    runner.stop();
  });

  it('aligns the first full cycle to the next UTC multiple of pollMs', () => {
    vi.useFakeTimers();
    try {
      const exitEvaluator = {
        evaluateOpenPositions: vi.fn(async () => undefined),
        updateRiskConfig: vi.fn(),
      } as unknown as WeatherExitEvaluator;

      const runner = buildRunner(exitEvaluator);
      runner.setRiskConfig(minimalRisk({ weatherAlgoPollMs: 60_000 })); // 1 min
      // Anchor "now" mid-slot: 10:00:30Z → next slot is 10:01:00Z.
      vi.setSystemTime(new Date('2026-08-11T10:00:30Z'));
      runner.start();

      // Boot exit pass fires immediately.
      expect(exitEvaluator.evaluateOpenPositions).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(29_000); // still before the aligned slot
      expect(exitEvaluator.evaluateOpenPositions).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(1_000); // reaches 10:01:00Z — full cycle runs
      expect(exitEvaluator.evaluateOpenPositions).toHaveBeenCalledTimes(2);

      runner.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('recreates the poll timer without an extra full cycle on poll change', async () => {
    const exitEvaluator = {
      evaluateOpenPositions: vi.fn(async () => undefined),
      updateRiskConfig: vi.fn(),
    } as unknown as WeatherExitEvaluator;

    const runner = buildRunner(exitEvaluator);
    runner.setRiskConfig(minimalRisk({ weatherAlgoPollMs: 60_000 }));
    runner.start();

    // Boot exit pass counts as the only immediate evaluation.
    expect(exitEvaluator.evaluateOpenPositions).toHaveBeenCalledTimes(1);

    const timerBefore = (runner as unknown as { timer: NodeJS.Timeout | null }).timer;
    expect(timerBefore).not.toBeNull();

    runner.setRiskConfig(minimalRisk({ weatherAlgoPollMs: 10_000 }));

    const timerAfter = (runner as unknown as { timer: NodeJS.Timeout | null }).timer;
    expect(timerAfter).not.toBeNull();
    expect(timerAfter).not.toBe(timerBefore);

    // Give microtasks a chance — setRiskConfig must not fire an extra full cycle
    await Promise.resolve();
    await Promise.resolve();
    expect(exitEvaluator.evaluateOpenPositions).toHaveBeenCalledTimes(1);

    runner.stop();
  });
});

describe('pickBestEdgeBucket', () => {
  function signal(overrides: Partial<WeatherSignal> = {}): WeatherSignal {
    return {
      conditionId: 'c1',
      assetId: 'a1',
      outcome: 'YES',
      side: 'BUY',
      confidence: 0.2,
      reasons: [],
      strategyId: 'weather-forecast',
      mode: 'sim',
      eventSlug: 'slug',
      city: 'Paris',
      metric: 'highest_temp',
      targetDate: new Date('2026-08-02T12:00:00Z'),
      forecastMean: 32,
      forecastStdDev: 1.5,
      forecastProbability: 0.2,
      marketPrice: 0.05,
      edge: 0.15,
      dynamicMinEdge: 0.05,
      entryBucketComparison: 'exact',
      entryBucketBounds: { target: 33 },
      ...overrides,
    };
  }

  it('returns the signal with the highest edge', () => {
    const candidates = [
      signal({ edge: 0.10, conditionId: 'low' }),
      signal({ edge: 0.25, conditionId: 'high' }),
      signal({ edge: 0.15, conditionId: 'mid' }),
    ];
    const best = pickBestEdgeBucket(candidates, 32);
    expect(best.conditionId).toBe('high');
  });

  it('ties break by bucket centre closest to forecastMean', () => {
    const candidates = [
      signal({ edge: 0.20, conditionId: 'far', entryBucketBounds: { target: 30 } }),
      signal({ edge: 0.20, conditionId: 'close', entryBucketBounds: { target: 32 } }),
    ];
    const best = pickBestEdgeBucket(candidates, 32);
    expect(best.conditionId).toBe('close');
  });

  it('uses midpoint of between buckets for tie-break', () => {
    const candidates = [
      signal({ edge: 0.20, conditionId: 'between-near', entryBucketComparison: 'between', entryBucketBounds: { low: 31, high: 33 } }),
      signal({ edge: 0.20, conditionId: 'between-far', entryBucketComparison: 'between', entryBucketBounds: { low: 28, high: 30 } }),
    ];
    const best = pickBestEdgeBucket(candidates, 32);
    expect(best.conditionId).toBe('between-near');
  });
});

describe('bucketCentre', () => {
  it('returns target for exact/or_* buckets', () => {
    expect(bucketCentre({ target: 33 }, 0)).toBe(33);
    expect(bucketCentre({ target: null, low: 20, high: 30 }, 0)).toBe(25);
  });

  it('returns midpoint for between buckets', () => {
    expect(bucketCentre({ low: 31, high: 33 }, 0)).toBe(32);
  });

  it('falls back to forecastMean when no bounds', () => {
    expect(bucketCentre({}, 32)).toBe(32);
  });
});

describe('evaluateCityFollowDateGroup best-edge integration', () => {
  function market(overrides: Partial<MarketListItemDto> = {}): MarketListItemDto {
    return {
      conditionId: 'cond-1',
      question: 'Will the highest temperature in Paris be 33°C on August 2?',
      eventSlug: 'paris-aug-2',
      tokenIdYes: 'yes-1',
      tokenIdNo: 'no-1',
      outcomePrices: [
        { outcome: 'Yes', price: 0.05 },
        { outcome: 'No', price: 0.95 },
      ],
      endDate: new Date(Date.now() + 48 * 3_600_000).toISOString(),
      closed: false,
      acceptingOrders: true,
      ...overrides,
    } as MarketListItemDto;
  }

  it('selects the bucket with the best edge among all active buckets', async () => {
    const strategy = {
      id: 'weather-forecast',
      evaluate: vi.fn(async (m: MarketListItemDto, ctx) => {
        const parsed = /(\d+)°C/.exec(m.question ?? '');
        const target = parsed ? Number(parsed[1]) : 0;
        const edge = 0.30 - Math.abs(target - 34) * 0.10;
        if (edge <= 0.05) return { kind: 'abstain' as const, reason: 'insufficient_edge' };
        return {
          kind: 'signal' as const,
          signal: {
            conditionId: m.conditionId,
            assetId: m.tokenIdYes!,
            outcome: 'YES',
            side: 'BUY',
            confidence: 0.5,
            reasons: [],
            strategyId: 'weather-forecast',
            mode: 'sim',
            eventSlug: m.eventSlug!,
            city: 'Paris',
            metric: 'highest_temp',
            targetDate: new Date(m.endDate!),
            forecastMean: ctx.forecastMean,
            forecastStdDev: ctx.forecastStdDev,
            forecastProbability: edge + 0.05,
            marketPrice: 0.05,
            edge,
            entryBucketComparison: 'exact',
            entryBucketBounds: { target },
          },
        };
      }),
      evaluateGroup: vi.fn(async (markets: MarketListItemDto[], ctx) => {
        const candidates: WeatherSignal[] = [];
        for (const m of markets) {
          const r = await strategy.evaluate(m, ctx);
          if (r.kind === 'signal') candidates.push(r.signal);
        }
        if (candidates.length === 0) {
          return { kind: 'abstain' as const, reason: 'insufficient_edge' };
        }
        return { kind: 'signal' as const, signal: pickBestEdgeBucket(candidates, ctx.forecastMean) };
      }),
    } as unknown as WeatherStrategy;

    const registrySim = {
      getAll: () => [strategy],
    } as unknown as WeatherStrategyRegistry;
    const registryReal = {
      getAll: () => [strategy],
    } as unknown as WeatherStrategyRegistry;

    const runner = new WeatherStrategyRunner({
      ds: {
        getRepository: () => ({ find: async () => [] }),
      } as never,
      autoTrackService: { listEnabled: async () => [] } as never,
      forecastService: {
        getOrFetch: vi.fn(async () => ({ forecastMean: 33, forecastStdDev: 1.5 })),
      } as never,
      registrySim,
      registryReal,
      redisCmd: {} as never,
      onSignal: async () => false,
      pollMs: 60_000,
      exitEvaluator: undefined,
    });

    const markets = [
      market({ conditionId: 'm-33', question: 'Will the highest temperature in Paris be 33°C on August 2?' }),
      market({ conditionId: 'm-34', question: 'Will the highest temperature in Paris be 34°C on August 2?' }),
      market({ conditionId: 'm-35', question: 'Will the highest temperature in Paris be 35°C on August 2?' }),
    ];

    const result = await (runner as unknown as { evaluateCityFollowDateGroup: (...args: unknown[]) => Promise<{ sim: WeatherSignal | null; real: WeatherSignal | null }> }).evaluateCityFollowDateGroup(
      1,
      'Paris',
      'highest_temp',
      '2026-08-02',
      markets,
      [],
      { sim: [strategy], real: [strategy] },
      new Map(),
      true,
      true,
    );

    expect(result).not.toBeNull();
    expect(result!.sim).not.toBeNull();
    expect(result!.sim!.conditionId).toBe('m-34');
    expect(result!.sim!.entryBucketBounds).toEqual({ target: 34 });
    expect(result!.real).not.toBeNull();
  });

  it('returns null when all buckets abstain', async () => {
    const strategy = {
      id: 'weather-forecast',
      evaluate: vi.fn(async () => ({ kind: 'abstain' as const, reason: 'insufficient_edge' })),
    } as unknown as WeatherStrategy;

    const registrySim = { getAll: () => [strategy] } as unknown as WeatherStrategyRegistry;
    const registryReal = { getAll: () => [strategy] } as unknown as WeatherStrategyRegistry;
    const runner = new WeatherStrategyRunner({
      ds: { getRepository: () => ({ find: async () => [] }) } as never,
      autoTrackService: { listEnabled: async () => [] } as never,
      forecastService: {
        getOrFetch: vi.fn(async () => ({ forecastMean: 33, forecastStdDev: 1.5 })),
      } as never,
      registrySim,
      registryReal,
      redisCmd: {} as never,
      onSignal: async () => false,
      pollMs: 60_000,
      exitEvaluator: undefined,
    });

    const result = await (runner as unknown as { evaluateCityFollowDateGroup: (...args: unknown[]) => Promise<{ sim: WeatherSignal | null; real: WeatherSignal | null }> }).evaluateCityFollowDateGroup(
      1,
      'Paris',
      'highest_temp',
      '2026-08-02',
      [market()],
      [],
      { sim: [strategy], real: [strategy] },
      new Map(),
      true,
      true,
    );

    expect(result).not.toBeNull();
    expect(result!.sim).toBeNull();
    expect(result!.real).toBeNull();
  });

  it('does not first-wins-cascade to a later strategy when the active one abstains', async () => {
    const abstain = {
      id: 'weather-forecast',
      evaluate: vi.fn(async () => ({ kind: 'abstain' as const, reason: 'insufficient_edge' })),
    } as unknown as WeatherStrategy;
    const fallback = {
      id: 'weather-highest-yes',
      evaluate: vi.fn(async () => ({
        kind: 'signal' as const,
        signal: {
          conditionId: 'hy',
          assetId: 'yes-1',
          outcome: 'YES',
          side: 'BUY',
          confidence: 0.5,
          reasons: [],
          strategyId: 'weather-highest-yes',
          mode: 'sim',
          eventSlug: 'paris-aug-2',
          city: 'Paris',
          metric: 'highest_temp',
          targetDate: new Date('2026-08-02T12:00:00Z'),
          forecastMean: 0,
          forecastStdDev: 0,
          forecastProbability: 0,
          marketPrice: 0.8,
          edge: 0,
          dynamicMinEdge: 0,
          entryBucketComparison: 'exact',
          entryBucketBounds: { target: 33 },
        },
      })),
    } as unknown as WeatherStrategy;

    const registrySim = { getAll: () => [abstain, fallback] } as unknown as WeatherStrategyRegistry;
    const registryReal = { getAll: () => [] } as unknown as WeatherStrategyRegistry;
    const runner = new WeatherStrategyRunner({
      ds: { getRepository: () => ({ find: async () => [] }) } as never,
      autoTrackService: { listEnabled: async () => [] } as never,
      forecastService: {
        getOrFetch: vi.fn(async () => ({ forecastMean: 33, forecastStdDev: 1.5 })),
      } as never,
      registrySim,
      registryReal,
      redisCmd: {} as never,
      onSignal: async () => false,
      pollMs: 60_000,
      exitEvaluator: undefined,
    });

    const result = await (runner as unknown as { evaluateCityFollowDateGroup: (...args: unknown[]) => Promise<{ sim: WeatherSignal | null; real: WeatherSignal | null }> }).evaluateCityFollowDateGroup(
      1,
      'Paris',
      'highest_temp',
      '2026-08-02',
      [market()],
      [],
      { sim: [abstain, fallback], real: [] },
      new Map(),
      true,
      false,
    );

    expect(result!.sim).toBeNull();
    expect(abstain.evaluate).toHaveBeenCalled();
    expect(fallback.evaluate).not.toHaveBeenCalled();
  });
});

describe('city+date gating', () => {
  function sig(overrides: Partial<WeatherSignal> & { conditionId: string }): WeatherSignal {
    return {
      assetId: 'a1',
      outcome: 'YES',
      side: 'BUY',
      confidence: 0.2,
      reasons: [],
      strategyId: 'weather-highest-yes',
      mode: 'sim',
      eventSlug: 'slug',
      city: 'Paris',
      metric: 'highest_temp',
      targetDate: new Date('2026-08-02T12:00:00Z'),
      forecastMean: 0,
      forecastStdDev: 0,
      forecastProbability: 0,
      marketPrice: 0,
      edge: 0,
      dynamicMinEdge: 0,
      entryBucketComparison: 'exact',
      entryBucketBounds: { target: 33 },
      ...overrides,
    };
  }

  it('dedupSignalsByCityDate keeps distinct dates of the same city', () => {
    const out = dedupSignalsByCityDate([
      sig({ conditionId: 'd1', city: 'Paris', targetDate: new Date('2026-08-02T12:00:00Z'), marketPrice: 0.55, edge: 0 }),
      sig({ conditionId: 'd2', city: 'Paris', targetDate: new Date('2026-08-03T12:00:00Z'), marketPrice: 0.80, edge: 0 }),
    ]);
    expect(out.map((s) => s.conditionId).sort()).toEqual(['d1', 'd2']);
  });

  it('dedupSignalsByCityDate collapses same city+date to the highest edge', () => {
    const out = dedupSignalsByCityDate([
      sig({ conditionId: 'low', city: 'Paris', targetDate: new Date('2026-08-02T12:00:00Z'), edge: 0.1, strategyId: 'weather-forecast' }),
      sig({ conditionId: 'high', city: 'Paris', targetDate: new Date('2026-08-02T12:00:00Z'), edge: 0.25, strategyId: 'weather-forecast' }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].conditionId).toBe('high');
  });

  it('dedupSignalsByCityDate keeps one signal per (city, date, strategy) lane', () => {
    const out = dedupSignalsByCityDate([
      sig({ conditionId: 'hy', city: 'Paris', targetDate: new Date('2026-08-02T12:00:00Z'), edge: 0, strategyId: 'weather-highest-yes' }),
      sig({ conditionId: 'fc', city: 'Paris', targetDate: new Date('2026-08-02T12:00:00Z'), edge: 0.2, strategyId: 'weather-forecast' }),
    ]);
    expect(out.map((s) => s.conditionId).sort()).toEqual(['fc', 'hy']);
  });

  it('dedupSignalsByCityDate returns empty for empty input', () => {
    expect(dedupSignalsByCityDate([])).toEqual([]);
  });
});

describe('mergeBucketsForSnapshot', () => {
  function bucket(
    conditionId: string,
    closed = false,
  ): { market: { conditionId: string; closed: boolean }; parsed: { comparison: string } } {
    return {
      market: { conditionId, closed },
      parsed: { comparison: 'exact' },
    } as never;
  }

  it('combines active and resolved buckets', () => {
    const merged = mergeBucketsForSnapshot(
      [bucket('a1'), bucket('a2')] as never,
      [bucket('r1'), bucket('r2')] as never,
    );
    expect(merged.map((b) => b.market.conditionId)).toEqual(['a1', 'a2', 'r1', 'r2']);
  });

  it('deduplicates by conditionId, keeping the active version first', () => {
    const merged = mergeBucketsForSnapshot(
      [bucket('shared')] as never,
      [bucket('shared'), bucket('only-resolved')] as never,
    );
    const ids = merged.map((b) => b.market.conditionId);
    expect(ids).toEqual(['shared', 'only-resolved']);
    expect(merged[0].market.closed).toBe(false);
  });

  it('keeps active-only and resolved-only distinct', () => {
    const merged = mergeBucketsForSnapshot(
      [bucket('active-only')] as never,
      [bucket('resolved-only')] as never,
    );
    expect(merged.map((b) => b.market.conditionId)).toEqual(['active-only', 'resolved-only']);
  });

  it('returns empty array when both inputs are empty', () => {
    expect(mergeBucketsForSnapshot([], [])).toEqual([]);
  });
});

describe('evaluateCityFollowDateGroup with open position', () => {
  function market(overrides: Partial<MarketListItemDto> = {}): MarketListItemDto {
    return {
      conditionId: 'cond-1',
      question: 'Will the highest temperature in Paris be 33°C on August 2?',
      eventSlug: 'paris-aug-2',
      tokenIdYes: 'yes-1',
      tokenIdNo: 'no-1',
      outcomePrices: [
        { outcome: 'Yes', price: 0.05 },
        { outcome: 'No', price: 0.95 },
      ],
      endDate: new Date(Date.now() + 48 * 3_600_000).toISOString(),
      closed: false,
      acceptingOrders: true,
      ...overrides,
    } as MarketListItemDto;
  }

  it('records snapshot but skips signal emission when the city+date is at capacity', async () => {
    const strategy = {
      id: 'weather-forecast',
      evaluate: vi.fn(async () => ({ kind: 'signal' as const, reason: undefined })),
    } as unknown as WeatherStrategy;
    const recordSnapshot = vi.fn(async () => ({ snapshotId: 1 }));
    const registrySim = { getAll: () => [strategy] } as unknown as WeatherStrategyRegistry;
    const registryReal = { getAll: () => [] } as unknown as WeatherStrategyRegistry;

    const runner = new WeatherStrategyRunner({
      ds: { getRepository: () => ({ find: async () => [] }) } as never,
      autoTrackService: { listEnabled: async () => [] } as never,
      forecastService: {
        getOrFetch: vi.fn(async () => ({ forecastMean: 33, forecastStdDev: 1.5 })),
      } as never,
      registrySim,
      registryReal,
      redisCmd: {} as never,
      onSignal: async () => false,
      pollMs: 60_000,
      marketSnapshotRecorder: { recordSnapshot } as never,
      exitEvaluator: undefined,
    });
    runner.setRiskConfig(
      minimalRisk({
        weatherAlgoMarketSnapshotRecordingEnabled: true,
      }),
    );

    const result = await (runner as unknown as { evaluateCityFollowDateGroup: (...args: unknown[]) => Promise<{ sim: WeatherSignal | null; real: WeatherSignal | null }> }).evaluateCityFollowDateGroup(
      1,
      'Paris',
      'highest_temp',
      '2026-08-02',
      [market()],
      [],
      { sim: [strategy], real: [] },
      new Map([['paris|2026-08-02|weather-forecast|sim', 1]]),
      true,
      true,
    );

    expect(recordSnapshot).toHaveBeenCalledTimes(1);
    expect(result!.sim).toBeNull();
    expect(strategy.evaluate).not.toHaveBeenCalled();
  });
});

describe('WeatherStrategyRunner safe reload', () => {
  function market(overrides: Partial<MarketListItemDto> = {}): MarketListItemDto {
    return {
      conditionId: 'cond-1',
      question: 'Will the highest temperature in Paris be 33°C on August 2?',
      eventSlug: 'paris-aug-2',
      tokenIdYes: 'yes-1',
      tokenIdNo: 'no-1',
      outcomePrices: [
        { outcome: 'Yes', price: 0.05 },
        { outcome: 'No', price: 0.95 },
      ],
      endDate: new Date(Date.now() + 48 * 3_600_000).toISOString(),
      closed: false,
      acceptingOrders: true,
      ...overrides,
    } as MarketListItemDto;
  }

  function signalStrategy(id: string, emit: boolean): WeatherStrategy {
    return {
      id,
      evaluate: vi.fn(async () =>
        emit
          ? {
              kind: 'signal' as const,
              signal: {
                conditionId: 'cond-1',
                assetId: 'yes-1',
                outcome: 'YES',
                side: 'BUY',
                confidence: 0.5,
                reasons: [],
                strategyId: id,
                mode: 'sim',
                eventSlug: 'paris-aug-2',
                city: 'Paris',
                metric: 'highest_temp',
                targetDate: new Date('2026-08-02T12:00:00Z'),
                forecastMean: 33,
                forecastStdDev: 1.5,
                forecastProbability: 0.5,
                marketPrice: 0.05,
                edge: 0.2,
                dynamicMinEdge: 0.05,
                entryBucketComparison: 'exact',
                entryBucketBounds: { target: 33 },
              },
            }
          : { kind: 'abstain' as const, reason: 'no_signal' },
      ),
    } as unknown as WeatherStrategy;
  }

  it('snapshots enabledStrategies at cycle start — a mid-cycle config change applies next cycle', async () => {
    const forecastStrategy = signalStrategy('weather-forecast', true);
    const alignedStrategy = signalStrategy('weather-forecast-aligned', true);
    const getOrdered = vi.fn((ids: string[]) =>
      ids
        .map((id) => [forecastStrategy, alignedStrategy].find((s) => s.id === id))
        .filter((s): s is WeatherStrategy => Boolean(s)),
    );
    const registrySim = {
      getAll: () => [forecastStrategy, alignedStrategy],
      getOrdered,
    } as unknown as WeatherStrategyRegistry;
    const registryReal = {
      getAll: () => [forecastStrategy, alignedStrategy],
      getOrdered,
    } as unknown as WeatherStrategyRegistry;

    // A city-follow rule so the cycle reaches strategy evaluation.
    const cityRule = { id: 1, city: 'Paris', metric: 'highest_temp', lookAheadDays: 1, enabled: true };

    // Gate the exit pass so we can change config mid-cycle.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let exitCalls = 0;
    const exitEvaluator = {
      evaluateOpenPositions: vi.fn(async () => {
        exitCalls += 1;
        if (exitCalls === 1) await gate;
      }),
      updateRiskConfig: vi.fn(),
    } as unknown as WeatherExitEvaluator;

    const runner = new WeatherStrategyRunner({
      ds: { getRepository: () => ({ find: async () => [] }) } as never,
      autoTrackService: { loadAllEnabled: async () => [cityRule] } as never,
      forecastService: {
        getOrFetch: vi.fn(async () => ({ forecastMean: 33, forecastStdDev: 1.5 })),
      } as never,
      registrySim,
      registryReal,
      redisCmd: {} as never,
      onSignal: async () => false,
      pollMs: 60_000,
      exitEvaluator,
    });

    // Cycle 1 starts with only weather-forecast enabled (both env toggles on).
    runner.setRiskConfig(
      minimalRisk({
        weatherAlgoEnabled: true,
        weatherAlgoSimEnabled: true,
        weatherAlgoRealEnabled: true,
        weatherAlgoStrategies: JSON.stringify(['weather-forecast']),
      }),
    );
    runner.requestEvaluationCycle();
    await Promise.resolve();
    await Promise.resolve();
    expect(exitCalls).toBe(1);

    // Mid-cycle: switch the uniquely enabled strategy to aligned. The running
    // cycle must NOT pick it up (safe reload) — it continues with the snapshot
    // taken at start (forecast only).
    runner.setRiskConfig(
      minimalRisk({
        weatherAlgoEnabled: true,
        weatherAlgoSimEnabled: true,
        weatherAlgoRealEnabled: true,
        weatherAlgoStrategies: JSON.stringify(['weather-forecast-aligned']),
      }),
    );

    release();
    // Let cycle 1 finish. getOrdered was called with the snapshot taken at
    // cycle start (only weather-forecast) — the mid-cycle change did NOT apply.
    await vi.waitFor(() => expect(exitCalls).toBe(1));
    await vi.waitFor(() => expect(getOrdered).toHaveBeenLastCalledWith(['weather-forecast']));

    // Cycle 2 runs with the new config — only aligned is enabled (one-active).
    runner.requestEvaluationCycle();
    await vi.waitFor(() => expect(exitCalls).toBe(2));
    await vi.waitFor(() =>
      expect(getOrdered).toHaveBeenLastCalledWith(['weather-forecast-aligned']),
    );

    runner.stop();
  });
});

describe('applySelectionMode', () => {
  function signal(overrides: Partial<WeatherSignal> = {}): WeatherSignal {
    return {
      conditionId: 'c1',
      assetId: 'a1',
      outcome: 'YES',
      side: 'BUY',
      confidence: 0.2,
      reasons: [],
      strategyId: 'weather-forecast',
      mode: 'sim',
      eventSlug: 'slug',
      city: 'Paris',
      metric: 'highest_temp',
      targetDate: new Date('2026-08-02T12:00:00Z'),
      forecastMean: 32,
      forecastStdDev: 1.5,
      forecastProbability: 0.2,
      marketPrice: 0.05,
      edge: 0.15,
      dynamicMinEdge: 0.05,
      entryBucketComparison: 'exact',
      entryBucketBounds: { target: 33 },
      ...overrides,
    };
  }

  it('single mode returns the highest-edge signal only', () => {
    const risk = minimalRisk({ weatherAlgoEnabled: true, weatherAlgoSelectionMode: 'single' });
    const result = applySelectionMode(
      [
        signal({ edge: 0.10, conditionId: 'low', city: 'Lyon' }),
        signal({ edge: 0.25, conditionId: 'high', city: 'Paris' }),
        signal({ edge: 0.15, conditionId: 'mid', city: 'Marseille' }),
      ],
      risk,
    );
    expect(result).toHaveLength(1);
    expect(result[0].conditionId).toBe('high');
  });

  it('multi mode returns top N by edge across distinct cities', () => {
    const risk = minimalRisk({
      weatherAlgoEnabled: true,
      weatherAlgoSelectionMode: 'multi',
      weatherAlgoMaxSignalsPerEvent: 2,
    });
    const result = applySelectionMode(
      [
        signal({ edge: 0.10, conditionId: 'low', city: 'Lyon' }),
        signal({ edge: 0.25, conditionId: 'high', city: 'Paris' }),
        signal({ edge: 0.15, conditionId: 'mid', city: 'Marseille' }),
      ],
      risk,
    );
    expect(result).toHaveLength(2);
    expect(result.map((s) => s.conditionId)).toEqual(['high', 'mid']);
  });

  it('multi mode keeps only top N even if same city appears multiple times (defensive guard)', () => {
    const risk = minimalRisk({
      weatherAlgoEnabled: true,
      weatherAlgoSelectionMode: 'multi',
      weatherAlgoMaxSignalsPerEvent: 2,
    });
    const result = applySelectionMode(
      [
        signal({ edge: 0.30, conditionId: 'a', city: 'Paris' }),
        signal({ edge: 0.20, conditionId: 'b', city: 'Paris' }),
        signal({ edge: 0.10, conditionId: 'c', city: 'Paris' }),
      ],
      risk,
    );
    expect(result).toHaveLength(2);
    expect(result.map((s) => s.conditionId)).toEqual(['a', 'b']);
  });

  it('returns empty array for empty input regardless of mode', () => {
    const risk = minimalRisk({ weatherAlgoEnabled: true, weatherAlgoSelectionMode: 'multi' });
    expect(applySelectionMode([], risk)).toEqual([]);
  });

  it('falls back to single for unknown selection mode (spread)', () => {
    const risk = minimalRisk({ weatherAlgoEnabled: true, weatherAlgoSelectionMode: 'spread' });
    const result = applySelectionMode(
      [
        signal({ edge: 0.10, conditionId: 'low', city: 'Lyon' }),
        signal({ edge: 0.25, conditionId: 'high', city: 'Paris' }),
        signal({ edge: 0.15, conditionId: 'mid', city: 'Marseille' }),
      ],
      risk,
    );
    expect(result).toHaveLength(1);
    expect(result[0].conditionId).toBe('high');
  });
});

describe('dedupSignalsByCityDate', () => {
  function sig(edge: number, conditionId: string, city: string): WeatherSignal {
    return {
      conditionId,
      assetId: 'a1',
      outcome: 'YES',
      side: 'BUY',
      confidence: 0.2,
      reasons: [],
      strategyId: 'weather-forecast',
      mode: 'sim',
      eventSlug: 'slug',
      city,
      metric: 'highest_temp',
      targetDate: new Date('2026-08-02T12:00:00Z'),
      forecastMean: 32,
      forecastStdDev: 1.5,
      forecastProbability: 0.2,
      marketPrice: 0.05,
      edge,
      dynamicMinEdge: 0.05,
      entryBucketComparison: 'exact',
      entryBucketBounds: { target: 33 },
    };
  }

  it('keeps only the highest-edge signal per city', () => {
    const result = dedupSignalsByCityDate([
      sig(0.30, 'paris-hi', 'Paris'),
      sig(0.25, 'paris-lo', 'paris'), // same normalized city, lower edge → dropped
      sig(0.28, 'lyon', 'Lyon'),
    ]);
    expect(result).toHaveLength(2);
    const byCity = new Map(result.map((s) => [s.city, s.conditionId]));
    expect(byCity.get('Paris')).toBe('paris-hi');
    expect(byCity.get('Lyon')).toBe('lyon');
  });

  it('preserves all signals when cities are distinct', () => {
    const result = dedupSignalsByCityDate([
      sig(0.10, 'a', 'Paris'),
      sig(0.20, 'b', 'Lyon'),
      sig(0.30, 'c', 'Marseille'),
    ]);
    expect(result).toHaveLength(3);
  });

  it('returns empty array for empty input', () => {
    expect(dedupSignalsByCityDate([])).toEqual([]);
  });

  it('regression C1: two rules same city do not starve a third city slot', () => {
    // Reproduces the bug fixed by deduping before applySelectionMode:
    // Paris(0.30), Paris(0.29), Lyon(0.28) with maxN=2 must yield Paris + Lyon,
    // not Paris only.
    const deduped = dedupSignalsByCityDate([
      sig(0.30, 'paris-1', 'Paris'),
      sig(0.29, 'paris-2', 'Paris'),
      sig(0.28, 'lyon-1', 'Lyon'),
    ]);
    expect(deduped).toHaveLength(2);
    // After dedup, a multi-mode selection with maxN=2 keeps both distinct cities.
    expect(deduped.map((s) => s.city).sort()).toEqual(['Lyon', 'Paris']);
  });
});