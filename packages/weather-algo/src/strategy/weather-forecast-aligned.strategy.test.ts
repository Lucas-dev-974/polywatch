import { describe, expect, it } from 'vitest';
import type { MarketListItemDto } from '@polywatch/core';
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
    strategy.setRiskConfig({ weatherAlgoMinEdge: 0.05 } as never);

    const markets = [
      market('Will the highest temperature in Paris be 22°C on July 30?', 0.4, 'low'),
      market('Will the highest temperature in Paris be 24°C on July 30?', 0.35, 'aligned'),
      market('Will the highest temperature in Paris be 26°C on July 30?', 0.3, 'high'),
    ];

    const result = await strategy.evaluateGroup(markets, {
      forecastMean: 24,
      forecastStdDev: 0.5,
    });

    expect(result.kind).toBe('signal');
    if (result.kind === 'signal') {
      expect(result.signal.conditionId).toBe('aligned');
      expect(result.signal.strategyId).toBe('weather-forecast-aligned');
    }
  });

  it('evaluateGroup abstains when forecast mean is outside all buckets', async () => {
    const strategy = new WeatherForecastAlignedStrategy();
    strategy.setRiskConfig({ weatherAlgoMinEdge: 0.05 } as never);

    const markets = [
      market('Will the highest temperature in Paris be 22°C on July 30?', 0.4, 'low'),
      market('Will the highest temperature in Paris be 24°C on July 30?', 0.35, 'mid'),
    ];

    const result = await strategy.evaluateGroup(markets, {
      forecastMean: 30,
      forecastStdDev: 0.5,
    });

    expect(result.kind).toBe('abstain');
    if (result.kind === 'abstain') {
      expect(result.reason).toBe('no_aligned_bucket');
    }
  });
});
