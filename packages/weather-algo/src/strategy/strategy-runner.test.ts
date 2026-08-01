import { describe, expect, it, vi } from 'vitest';
import type { WeatherConfig } from '@polywatch/core';
import { WeatherStrategyRunner } from './strategy-runner.js';
import type { WeatherStrategyRegistry } from './registry.js';
import type { WeatherExitEvaluator } from '../processors/weather-exit-evaluator.js';

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
  } as unknown as WeatherStrategyRegistry;

  return new WeatherStrategyRunner({
    ds: {
      getRepository: () => ({
        find: async () => [],
      }),
    } as never,
    selectionService: {} as never,
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
