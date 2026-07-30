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

describe('WeatherForecastStrategy city-first yesOnly', () => {
  it('emits BUY YES when yes edge clears threshold', async () => {
    const strategy = new WeatherForecastStrategy();
    strategy.setMinEdge(0.05);
    strategy.setYesOnly(true);

    const result = await strategy.evaluate(market(), {
      forecastMean: 24,
      forecastStdDev: 0.5,
      tempDistribution: new Map(),
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
    strategy.setYesOnly(true);

    // Forecast far from 24 → low YES prob → YES underpriced? Actually YES edge negative;
    // market YES expensive relative to forecast → NO would have edge, but yesOnly abstains.
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
        tempDistribution: new Map(),
      },
    );

    expect(result.kind).toBe('abstain');
    if (result.kind === 'abstain') {
      expect(result.reason).toBe('insufficient_edge');
    }
  });
});
