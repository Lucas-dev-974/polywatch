import { describe, expect, it } from 'vitest';
import type { MarketListItemDto } from '@polywatch/core';
import { DEFAULT_WEATHER_STRATEGY_PARAMS } from '@polywatch/core';
import { WeatherForecastAlignedStrategy } from './weather-forecast-aligned.strategy.js';

function market(
  question: string,
  yesPrice: number,
  conditionId: string,
): MarketListItemDto {
  return {
    conditionId,
    question,
    eventSlug: 'test-event',
    tokenIdYes: `yes-${conditionId}`,
    tokenIdNo: `no-${conditionId}`,
    outcomePrices: [
      { outcome: 'Yes', price: yesPrice },
      { outcome: 'No', price: 1 - yesPrice },
    ],
    endDate: new Date(Date.now() + 72 * 3_600_000).toISOString(),
    closed: false,
    acceptingOrders: true,
  } as MarketListItemDto;
}

describe('WeatherForecastAlignedStrategy', () => {
  it('evaluateGroup picks the bucket containing forecast mean', async () => {
    const strategy = new WeatherForecastAlignedStrategy();
    strategy.setRiskConfig({ ...DEFAULT_WEATHER_STRATEGY_PARAMS, minEdge: 0.05 });

    const markets = [
      market('Will the highest temperature in Paris be 22°C on July 30?', 0.4, 'low'),
      market('Will the highest temperature in Paris be 24°C on July 30?', 0.35, 'aligned'),
      market('Will the highest temperature in Paris be 26°C on July 30?', 0.3, 'high'),
    ];

    const result = await strategy.evaluateGroup(markets, {
      forecastMean: 24,
      forecastStdDev: 0.5,
      mode: 'sim',
    });

    expect(result.kind).toBe('signal');
    if (result.kind === 'signal') {
      expect(result.signal.conditionId).toBe('aligned');
      expect(result.signal.strategyId).toBe('weather-forecast-aligned');
    }
  });

  it('evaluateGroup abstains when forecast mean is outside all buckets', async () => {
    const strategy = new WeatherForecastAlignedStrategy();
    strategy.setRiskConfig({ ...DEFAULT_WEATHER_STRATEGY_PARAMS, minEdge: 0.05 });

    const markets = [
      market('Will the highest temperature in Paris be 22°C on July 30?', 0.4, 'low'),
      market('Will the highest temperature in Paris be 24°C on July 30?', 0.35, 'mid'),
    ];

    const result = await strategy.evaluateGroup(markets, {
      forecastMean: 30,
      forecastStdDev: 0.5,
      mode: 'sim',
    });

    expect(result.kind).toBe('abstain');
    if (result.kind === 'abstain') {
      expect(result.reason).toBe('no_aligned_bucket');
    }
  });

  it('evaluate abstains when YES price is below minYesPrice', async () => {
    const strategy = new WeatherForecastAlignedStrategy();
    strategy.setRiskConfig({
      ...DEFAULT_WEATHER_STRATEGY_PARAMS,
      minEdge: 0.05,
      minYesPrice: 0.2,
    });

    const result = await strategy.evaluate(
      market('Will the highest temperature in Paris be 24°C on July 30?', 0.10, 'cheap'),
      {
        forecastMean: 24,
        forecastStdDev: 0.5,
        mode: 'sim',
      },
    );

    expect(result.kind).toBe('abstain');
    if (result.kind === 'abstain') {
      expect(result.reason).toBe('yes_price_below_min');
    }
  });

  it('evaluate emits a signal when YES price is at or above minYesPrice', async () => {
    const strategy = new WeatherForecastAlignedStrategy();
    strategy.setRiskConfig({
      ...DEFAULT_WEATHER_STRATEGY_PARAMS,
      minEdge: 0.05,
      minYesPrice: 0.2,
    });

    const result = await strategy.evaluate(
      market('Will the highest temperature in Paris be 24°C on July 30?', 0.20, 'floor'),
      {
        forecastMean: 24,
        forecastStdDev: 0.5,
        mode: 'sim',
      },
    );

    expect(result.kind).toBe('signal');
  });

  it('evaluate does not apply the YES-price floor when minYesPrice is null', async () => {
    const strategy = new WeatherForecastAlignedStrategy();
    strategy.setRiskConfig({
      ...DEFAULT_WEATHER_STRATEGY_PARAMS,
      minEdge: 0.05,
      minYesPrice: null,
    });

    const result = await strategy.evaluate(
      market('Will the highest temperature in Paris be 24°C on July 30?', 0.10, 'cheap'),
      {
        forecastMean: 24,
        forecastStdDev: 0.5,
        mode: 'sim',
      },
    );

    expect(result.kind).toBe('signal');
  });
});
