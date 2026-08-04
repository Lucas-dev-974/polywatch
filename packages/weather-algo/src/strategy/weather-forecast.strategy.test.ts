import { describe, expect, it } from 'vitest';
import type { MarketListItemDto } from '@polywatch/core';
import { WeatherForecastStrategy } from './weather-forecast.strategy.js';

function market(overrides: Partial<MarketListItemDto> = {}): MarketListItemDto {
  return {
    conditionId: 'cond-1',
    question: 'Will the highest temperature in Paris be 24°C on July 30?',
    eventSlug: 'paris-july-30',
    tokenIdYes: 'yes-token',
    tokenIdNo: 'no-token',
    outcomePrices: [
      { outcome: 'Yes', price: 0.35 },
      { outcome: 'No', price: 0.65 },
    ],
    endDate: new Date(Date.now() + 48 * 3_600_000).toISOString(),
    closed: false,
    acceptingOrders: true,
    ...overrides,
  } as MarketListItemDto;
}

describe('WeatherForecastStrategy city-first', () => {
  it('emits BUY YES when yes edge clears threshold', async () => {
    const strategy = new WeatherForecastStrategy();
    strategy.setMinEdge(0.05);

    const result = await strategy.evaluate(market(), {
      forecastMean: 24,
      forecastStdDev: 0.5,
    });

    expect(result.kind).toBe('signal');
    if (result.kind === 'signal') {
      expect(result.signal.outcome).toBe('YES');
      expect(result.signal.side).toBe('BUY');
      expect(result.signal.assetId).toBe('yes-token');
    }
  });

  it('does not emit BUY NO even if NO edge would be larger', async () => {
    const strategy = new WeatherForecastStrategy();
    strategy.setMinEdge(0.05);

    // City-first directional thesis: even when NO would have edge, the strategy
    // abstains (BUY NO is not a supported path). With forecastMean far below
    // the bucket target, forecast-implied YES probability collapses to 0,
    // so the strategy abstains with `zero_forecast_probability` (the forecast
    // gives no support to the YES outcome) — never emits BUY NO.
    const result = await strategy.evaluate(
      market({
        outcomePrices: [
          { outcome: 'Yes', price: 0.90 },
          { outcome: 'No', price: 0.10 },
        ],
      }),
      {
        forecastMean: 18,
        forecastStdDev: 0.5,
      },
    );

    expect(result.kind).toBe('abstain');
    if (result.kind === 'abstain') {
      expect(['zero_forecast_probability', 'insufficient_edge']).toContain(result.reason);
    }
  });

  it('abstains when forecast YES probability is below minForecastProbability (long-shot filter)', async () => {
    const strategy = new WeatherForecastStrategy();
    strategy.setMinEdge(0.05);
    strategy.setMinForecastProbability(0.30);

    // forecastMean = 22, target = 24, std = 0.5 → P(YES) ≈ 0 (well below 0.30).
    // Even if the market price were near 0 (large edge), the long-shot filter
    // must reject the signal.
    const result = await strategy.evaluate(market(), {
      forecastMean: 22,
      forecastStdDev: 0.5,
    });

    expect(result.kind).toBe('abstain');
    if (result.kind === 'abstain') {
      expect(result.reason).toBe('forecast_probability_below_min');
    }
  });

  it('emits a signal when forecast YES probability clears minForecastProbability', async () => {
    const strategy = new WeatherForecastStrategy();
    strategy.setMinEdge(0.05);
    strategy.setMinForecastProbability(0.30);

    // forecastMean = 24, target = 24, std = 0.5 → P(YES) ≈ 0.76 (above 0.30).
    const result = await strategy.evaluate(market(), {
      forecastMean: 24,
      forecastStdDev: 0.5,
    });

    expect(result.kind).toBe('signal');
  });

  it('does not apply the long-shot filter when minForecastProbability is null', async () => {
    const strategy = new WeatherForecastStrategy();
    strategy.setMinEdge(0.05);
    strategy.setMinForecastProbability(null);

    // Low forecastProb but edge passes → signal emitted (legacy behavior).
    // forecastMean = 25.2, target = 24, std = 0.5 → P(YES) very small but > 0.
    const result = await strategy.evaluate(market(), {
      forecastMean: 25.2,
      forecastStdDev: 0.5,
    });

    // Either a signal (if edge passes) or abstain for a non-probability reason;
    // must NOT be 'forecast_probability_below_min'.
    if (result.kind === 'abstain') {
      expect(result.reason).not.toBe('forecast_probability_below_min');
    }
  });
});
