import { describe, expect, it } from 'vitest';
import type { WeatherSignal } from './strategy.js';
import { dedupSignalsByCityDate, applySelectionMode } from './strategy-runner-selection.js';

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
  it('dedupSignalsByCityDate keeps one signal per (city, strategy) lane', () => {
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

    const out = dedupSignalsByCityDate([bestEdge, highestYes]);
    expect(out).toHaveLength(2);
    const ids = out.map((s) => s.conditionId).sort();
    expect(ids).toEqual(['best-edge', 'highest-yes']);
  });

  it('dedupSignalsByCityDate keeps the highest edge within the same lane', () => {
      const low = signal({ conditionId: 'low', strategyId: 'weather-forecast', city: 'Paris', edge: 0.1 });
      const high = signal({ conditionId: 'high', strategyId: 'weather-forecast', city: 'Paris', edge: 0.3 });

      const out = dedupSignalsByCityDate([low, high]);
      expect(out).toHaveLength(1);
      expect(out[0].conditionId).toBe('high');
    });

    it('applySelectionMode single picks best city+date pair, not just city', () => {
      const forecastJ1 = signal({
        conditionId: 'fc-j1',
        strategyId: 'weather-forecast',
        city: 'Paris',
        targetDate: new Date('2026-08-02T12:00:00Z'),
        edge: 0.2,
      });
      const highestYesJ2 = signal({
        conditionId: 'hy-j2',
        strategyId: 'weather-highest-yes',
        city: 'Paris',
        targetDate: new Date('2026-08-03T12:00:00Z'),
        edge: 0,
        marketPrice: 0.8,
      });
      const forecastLyonJ1 = signal({
        conditionId: 'fc-lyon',
        strategyId: 'weather-forecast',
        city: 'Lyon',
        targetDate: new Date('2026-08-02T12:00:00Z'),
        edge: 0.15,
      });

      const out = applySelectionMode([forecastJ1, highestYesJ2, forecastLyonJ1], {
        weatherAlgoSelectionMode: 'single',
      } as never);
      // Best edge is forecastJ1 (0.2) on Paris 2026-08-02
      // Should return only signals for Paris 2026-08-02
      expect(out.every(s => s.targetDate.toISOString().slice(0, 10) === '2026-08-02')).toBe(true);
      expect(out.some(s => s.strategyId === 'weather-forecast')).toBe(true);
      // highestYesJ2 is on different date, should NOT be included
      expect(out.some(s => s.conditionId === 'hy-j2')).toBe(false);
    });

    it('applySelectionMode single returns all lanes for best city+date', () => {
      const forecast = signal({
        conditionId: 'fc',
        strategyId: 'weather-forecast',
        city: 'Paris',
        targetDate: new Date('2026-08-02T12:00:00Z'),
        edge: 0.2,
      });
      const highestYes = signal({
        conditionId: 'hy',
        strategyId: 'weather-highest-yes',
        city: 'Paris',
        targetDate: new Date('2026-08-02T12:00:00Z'),
        edge: 0,
        marketPrice: 0.8,
      });
      const aligned = signal({
        conditionId: 'fa',
        strategyId: 'weather-forecast-aligned',
        city: 'Paris',
        targetDate: new Date('2026-08-02T12:00:00Z'),
        edge: 0.15,
      });

      const out = applySelectionMode([forecast, highestYes, aligned], {
        weatherAlgoSelectionMode: 'single',
      } as never);
      expect(out).toHaveLength(3); // All three lanes for best city+date
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
