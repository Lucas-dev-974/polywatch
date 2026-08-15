import { describe, expect, it } from 'vitest';
import type { WeatherSignal } from '@polywatch/weather-algo';
import {
  evaluateRunnerSimGroup,
  selectRunnerSimSignals,
  buildActiveMarketsForGroup,
} from './runner-sim.js';
import { createWeatherStrategy } from './clocked-weather-strategy.js';
import type { BookTickEventData } from '../../engine/events.js';

function tick(overrides: Partial<BookTickEventData> = {}): BookTickEventData {
  return {
    conditionId: 'cond-1',
    snapshotCity: 'paris',
    snapshotTargetDateIso: '2026-07-30',
    snapshotMetric: 'highest_temp',
    snapshotForecastMean: 24,
    yesPrice: 0.35,
    noPrice: 0.65,
    bucketComparison: 'exact',
    bucketTarget: 24,
    bucketLow: null,
    bucketHigh: null,
    eventSlug: 'paris-july-30',
    tokenIdYes: 'yes-1',
    endDate: new Date(Date.now() + 48 * 3_600_000),
    closed: false,
    acceptingOrders: true,
    volume: 1000,
    volume24hr: 100,
    liquidityClob: 500,
    question: 'Will the highest temperature in Paris be 24°C on July 30?',
    ...overrides,
  };
}

describe('runner-sim helpers', () => {
  it('evaluateRunnerSimGroup returns signal from first winning strategy', async () => {
    const forecast = createWeatherStrategy('weather-forecast');
    const aligned = createWeatherStrategy('weather-forecast-aligned');
    forecast.setRiskConfig({ weatherAlgoMinEdge: 0.05 } as never);
    aligned.setRiskConfig({ weatherAlgoMinEdge: 0.05 } as never);

    const t = tick();
    const nowMs = Date.now();
    const markets = buildActiveMarketsForGroup([t], 1, nowMs);
    expect(markets.length).toBeGreaterThan(0);
    const signal = await evaluateRunnerSimGroup(
      [forecast, aligned],
      markets,
      { forecastMean: 24, forecastStdDev: 0.5 },
      new Date(nowMs),
    );

    expect(signal).not.toBeNull();
    expect(signal!.strategyId).toBe('weather-forecast');
  });

  it('selectRunnerSimSignals dedups by city keeping highest edge', () => {
    const risk = {
      weatherAlgoSelectionMode: 'single',
    } as never;

    const signals: WeatherSignal[] = [
      {
        conditionId: 'a',
        city: 'paris',
        targetDate: new Date('2026-08-02T12:00:00Z'),
        edge: 0.2,
        strategyId: 'weather-forecast',
      } as WeatherSignal,
      {
        conditionId: 'b',
        city: 'paris',
        targetDate: new Date('2026-08-02T12:00:00Z'),
        edge: 0.3,
        strategyId: 'weather-forecast',
      } as WeatherSignal,
    ];

    const selected = selectRunnerSimSignals(signals, risk);
    expect(selected).toHaveLength(1);
    expect(selected[0]!.conditionId).toBe('b');
  });

  it('aligned strategy targets the bucket containing forecast mean', async () => {
    const tBetween = tick({
      conditionId: 'between',
      bucketComparison: 'between',
      bucketTarget: null,
      bucketLow: 23,
      bucketHigh: 25,
      yesPrice: 0.35,
      question: 'Will the highest temperature in Paris be between 23-25°C on July 30?',
    });
    const tHigh = tick({
      conditionId: 'high',
      bucketTarget: 26,
      yesPrice: 0.08,
      question: 'Will the highest temperature in Paris be 26°C on July 30?',
    });

    const nowMs = Date.now();
    const markets = buildActiveMarketsForGroup([tBetween, tHigh], 1, nowMs);
    const aligned = createWeatherStrategy('weather-forecast-aligned');
    aligned.setRiskConfig({ weatherAlgoMinEdge: 0.05 } as never);

    const signal = await evaluateRunnerSimGroup(
      [aligned],
      markets,
      { forecastMean: 24, forecastStdDev: 0.5 },
      new Date(nowMs),
    );

    expect(signal?.conditionId).toBe('between');
  });
});
