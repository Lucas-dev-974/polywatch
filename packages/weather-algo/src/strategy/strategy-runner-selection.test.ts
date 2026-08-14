import { describe, expect, it } from 'vitest';
import type { WeatherSignal } from './strategy.js';
import { dedupSignalsByCity, applySelectionMode } from './strategy-runner-selection.js';

function signal(overrides: Partial<WeatherSignal>): WeatherSignal {
  return {
    conditionId: 'cond',
    assetId: 'yes-token',
    outcome: 'YES',
    side: 'BUY',
    confidence: 0.5,
    reasons: [],
    strategyId: 'weather-forecast',
    eventSlug: 'evt',
    city: 'Paris',
    metric: 'highest_temp',
    targetDate: new Date(),
    forecastMean: 0,
    forecastStdDev: 0,
    forecastProbability: 0,
    marketPrice: 0.5,
    edge: 0,
    dynamicMinEdge: 0,
    ...overrides,
  };
}

describe('strategy-runner-selection (lane-based)', () => {
  it('dedupSignalsByCity keeps one signal per (city, strategy) lane', () => {
    const bestEdge = signal({
      conditionId: 'best-edge',
      strategyId: 'weather-forecast',
      city: 'Paris',
      edge: 0.2,
    });
    const highestYes = signal({
      conditionId: 'highest-yes',
      strategyId: 'weather-highest-yes',
      city: 'Paris',
      edge: 0,
      marketPrice: 0.8,
    });

    const out = dedupSignalsByCity([bestEdge, highestYes]);
    expect(out).toHaveLength(2);
    const ids = out.map((s) => s.conditionId).sort();
    expect(ids).toEqual(['best-edge', 'highest-yes']);
  });

  it('dedupSignalsByCity keeps the highest edge within the same lane', () => {
    const low = signal({ conditionId: 'low', strategyId: 'weather-forecast', city: 'Paris', edge: 0.1 });
    const high = signal({ conditionId: 'high', strategyId: 'weather-forecast', city: 'Paris', edge: 0.3 });

    const out = dedupSignalsByCity([low, high]);
    expect(out).toHaveLength(1);
    expect(out[0].conditionId).toBe('high');
  });

  it('applySelectionMode single keeps highest-yes as a candidate alongside best-edge', () => {
    const bestEdge = signal({
      conditionId: 'best-edge',
      strategyId: 'weather-forecast',
      city: 'Paris',
      edge: 0.2,
    });
    const highestYes = signal({
      conditionId: 'highest-yes',
      strategyId: 'weather-highest-yes',
      city: 'Paris',
      edge: 0,
    });

    const out = applySelectionMode([bestEdge, highestYes], {
      weatherAlgoSelectionMode: 'single',
    } as never);
    expect(out).toHaveLength(2);
  });

  it('applySelectionMode multi guarantees at least one signal per emitting strategy', () => {
    const bestEdge = signal({
      conditionId: 'best-edge',
      strategyId: 'weather-forecast',
      city: 'Paris',
      edge: 0.2,
    });
    const highestYes = signal({
      conditionId: 'highest-yes',
      strategyId: 'weather-highest-yes',
      city: 'Paris',
      edge: 0,
    });

    const out = applySelectionMode([bestEdge, highestYes], {
      weatherAlgoSelectionMode: 'multi',
      weatherAlgoMaxSignalsPerEvent: 2,
    } as never);
    const strategies = new Set(out.map((s) => s.strategyId));
    expect(strategies).toContain('weather-forecast');
    expect(strategies).toContain('weather-highest-yes');
  });
});
