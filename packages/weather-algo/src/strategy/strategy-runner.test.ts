import { describe, expect, it, vi } from 'vitest';
import type { WeatherConfig, MarketListItemDto } from '@polywatch/core';
import { WeatherStrategyRunner } from './strategy-runner.js';
import type { WeatherStrategyRegistry } from './registry.js';
import type { WeatherExitEvaluator } from '../processors/weather-exit-evaluator.js';
import type { WeatherSignal, WeatherStrategy } from './strategy.js';
import { pickBestEdgeBucket, bucketCentre } from './bucket-selection.js';
import { dedupSignalsByCity, applySelectionMode } from './strategy-runner-selection.js';

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
    registry,
    redisCmd: {} as never,
    onSignal: async () => false,
    pollMs: 60_000,
    exitEvaluator,
  });
}

describe('WeatherStrategyRunner setRiskConfig propagation', () => {
  it('calls setRiskConfig on each registered strategy that implements it', () => {
    const setRiskConfig = vi.fn();
    const strategy = {
      id: 'mock-strategy',
      evaluate: vi.fn(),
      setRiskConfig,
    } as unknown as WeatherStrategy;
    const registry = {
      getAll: () => [strategy],
    } as unknown as WeatherStrategyRegistry;

    const runner = new WeatherStrategyRunner({
      ds: { getRepository: () => ({ find: async () => [] }) } as never,
      autoTrackService: { listEnabled: async () => [] } as never,
      forecastService: {} as never,
      registry,
      redisCmd: {} as never,
      onSignal: async () => false,
      pollMs: 60_000,
    });

    const risk = minimalRisk({ weatherAlgoMinEdge: 0.25, weatherAlgoMaxForecastStd: 1.2 });
    runner.setRiskConfig(risk);

    expect(setRiskConfig).toHaveBeenCalledTimes(1);
    expect(setRiskConfig).toHaveBeenCalledWith(risk);
  });

  it('does not throw when a strategy does not implement setRiskConfig', () => {
    const strategy = {
      id: 'no-setconfig-strategy',
      evaluate: vi.fn(),
    } as unknown as WeatherStrategy;
    const registry = {
      getAll: () => [strategy],
    } as unknown as WeatherStrategyRegistry;

    const runner = new WeatherStrategyRunner({
      ds: { getRepository: () => ({ find: async () => [] }) } as never,
      autoTrackService: { listEnabled: async () => [] } as never,
      forecastService: {} as never,
      registry,
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

  it('restarts the poll timer without an immediate second cycle on poll change', async () => {
    const exitEvaluator = {
      evaluateOpenPositions: vi.fn(async () => undefined),
      updateRiskConfig: vi.fn(),
    } as unknown as WeatherExitEvaluator;

    const runner = buildRunner(exitEvaluator);
    runner.setRiskConfig(minimalRisk({ weatherAlgoPollMs: 60_000 }));
    runner.start();

    await vi.waitFor(() => expect(exitEvaluator.evaluateOpenPositions).toHaveBeenCalledTimes(1));

    const timerBefore = (runner as unknown as { timer: NodeJS.Timeout | null }).timer;
    expect(timerBefore).not.toBeNull();

    runner.setRiskConfig(minimalRisk({ weatherAlgoPollMs: 10_000 }));

    const timerAfter = (runner as unknown as { timer: NodeJS.Timeout | null }).timer;
    expect(timerAfter).not.toBeNull();
    expect(timerAfter).not.toBe(timerBefore);

    // Give microtasks a chance — setRiskConfig must not fire an extra cycle
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

    const registry = {
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
      registry,
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

    const result = await (runner as unknown as { evaluateCityFollowDateGroup: (...args: unknown[]) => Promise<WeatherSignal | null> }).evaluateCityFollowDateGroup(
      1,
      'Paris',
      'highest_temp',
      '2026-08-02',
      markets,
      [strategy],
      1,
    );

    expect(result).not.toBeNull();
    expect(result!.conditionId).toBe('m-34');
    expect(result!.entryBucketBounds).toEqual({ target: 34 });
  });

  it('returns null when all buckets abstain', async () => {
    const strategy = {
      id: 'weather-forecast',
      evaluate: vi.fn(async () => ({ kind: 'abstain' as const, reason: 'insufficient_edge' })),
    } as unknown as WeatherStrategy;

    const registry = { getAll: () => [strategy] } as unknown as WeatherStrategyRegistry;
    const runner = new WeatherStrategyRunner({
      ds: { getRepository: () => ({ find: async () => [] }) } as never,
      autoTrackService: { listEnabled: async () => [] } as never,
      forecastService: {
        getOrFetch: vi.fn(async () => ({ forecastMean: 33, forecastStdDev: 1.5 })),
      } as never,
      registry,
      redisCmd: {} as never,
      onSignal: async () => false,
      pollMs: 60_000,
      exitEvaluator: undefined,
    });

    const result = await (runner as unknown as { evaluateCityFollowDateGroup: (...args: unknown[]) => Promise<WeatherSignal | null> }).evaluateCityFollowDateGroup(
      1,
      'Paris',
      'highest_temp',
      '2026-08-02',
      [market()],
      [strategy],
      1,
    );

    expect(result).toBeNull();
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

  function buildRunnerForSelection(risk: WeatherConfig) {
    const registry = { getAll: () => [] } as unknown as WeatherStrategyRegistry;
    const runner = new WeatherStrategyRunner({
      ds: { getRepository: () => ({ find: async () => [] }) } as never,
      autoTrackService: { listEnabled: async () => [] } as never,
      forecastService: {} as never,
      registry,
      redisCmd: {} as never,
      onSignal: async () => false,
      pollMs: 60_000,
    });
    runner.setRiskConfig(risk);
    return runner;
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

describe('dedupSignalsByCity', () => {
  function sig(edge: number, conditionId: string, city: string): WeatherSignal {
    return {
      conditionId,
      assetId: 'a1',
      outcome: 'YES',
      side: 'BUY',
      confidence: 0.2,
      reasons: [],
      strategyId: 'weather-forecast',
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
    const result = dedupSignalsByCity([
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
    const result = dedupSignalsByCity([
      sig(0.10, 'a', 'Paris'),
      sig(0.20, 'b', 'Lyon'),
      sig(0.30, 'c', 'Marseille'),
    ]);
    expect(result).toHaveLength(3);
  });

  it('returns empty array for empty input', () => {
    expect(dedupSignalsByCity([])).toEqual([]);
  });

  it('regression C1: two rules same city do not starve a third city slot', () => {
    // Reproduces the bug fixed by deduping before applySelectionMode:
    // Paris(0.30), Paris(0.29), Lyon(0.28) with maxN=2 must yield Paris + Lyon,
    // not Paris only.
    const deduped = dedupSignalsByCity([
      sig(0.30, 'paris-1', 'Paris'),
      sig(0.29, 'paris-2', 'Paris'),
      sig(0.28, 'lyon-1', 'Lyon'),
    ]);
    expect(deduped).toHaveLength(2);
    // After dedup, a multi-mode selection with maxN=2 keeps both distinct cities.
    expect(deduped.map((s) => s.city).sort()).toEqual(['Lyon', 'Paris']);
  });
});