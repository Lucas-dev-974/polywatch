import { describe, expect, it } from 'vitest';
import type { MarketListItemDto } from '@polywatch/core';
import { WeatherHighestYesStrategy } from './weather-highest-yes.strategy.js';

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

describe('WeatherHighestYesStrategy', () => {
  it('emits BUY YES on the bucket with the highest YES price', async () => {
    const strategy = new WeatherHighestYesStrategy();
    strategy.setRiskConfig({ minYesPrice: 0.5 } as never);

    const low = market({
      conditionId: 'low',
      question: 'Will the highest temperature in Paris be 22°C on July 30?',
      outcomePrices: [
        { outcome: 'Yes', price: 0.55 },
        { outcome: 'No', price: 0.45 },
      ],
    });
    const high = market({
      conditionId: 'high',
      question: 'Will the highest temperature in Paris be 24°C on July 30?',
      outcomePrices: [
        { outcome: 'Yes', price: 0.80 },
        { outcome: 'No', price: 0.20 },
      ],
    });

    const result = await strategy.evaluateGroup([low, high], {
      forecastMean: 0,
      forecastStdDev: 0,
    });

    expect(result.kind).toBe('signal');
    if (result.kind === 'signal') {
      expect(result.signal.conditionId).toBe('high');
      expect(result.signal.outcome).toBe('YES');
      expect(result.signal.side).toBe('BUY');
      expect(result.signal.assetId).toBe('yes-token');
      expect(result.signal.marketPrice).toBe(0.8);
      expect(result.signal.edge).toBe(0);
      expect(result.signal.forecastMean).toBe(0);
    }
  });

  it('filters buckets below minYesPrice', async () => {
    const strategy = new WeatherHighestYesStrategy();
    strategy.setRiskConfig({ minYesPrice: 0.6 } as never);

    const result = await strategy.evaluateGroup(
      [
        market({
          conditionId: 'low',
          outcomePrices: [
            { outcome: 'Yes', price: 0.55 },
            { outcome: 'No', price: 0.45 },
          ],
        }),
      ],
      { forecastMean: 0, forecastStdDev: 0 },
    );

    expect(result.kind).toBe('abstain');
    if (result.kind === 'abstain') {
      expect(result.reason).toBe('no_high_yes_bucket');
    }
  });

  it('filters buckets above maxYesPrice (anti-fade ceiling)', async () => {
    const strategy = new WeatherHighestYesStrategy();
    strategy.setRiskConfig({ minYesPrice: 0.5, maxYesPrice: 0.7 } as never);

    const result = await strategy.evaluateGroup(
      [
        market({
          conditionId: 'low',
          outcomePrices: [
            { outcome: 'Yes', price: 0.55 },
            { outcome: 'No', price: 0.45 },
          ],
        }),
        market({
          conditionId: 'high',
          outcomePrices: [
            { outcome: 'Yes', price: 0.80 },
            { outcome: 'No', price: 0.20 },
          ],
        }),
      ],
      { forecastMean: 0, forecastStdDev: 0 },
    );

    // 0.80 dépasse le plafond 0.70 → exclu ; seul 0.55 reste éligible.
    expect(result.kind).toBe('signal');
    if (result.kind === 'signal') {
      expect(result.signal.conditionId).toBe('low');
    }
  });

  it('abstains when every bucket exceeds maxYesPrice', async () => {
    const strategy = new WeatherHighestYesStrategy();
    strategy.setRiskConfig({ minYesPrice: 0.5, maxYesPrice: 0.6 } as never);

    const result = await strategy.evaluateGroup(
      [
        market({
          conditionId: 'high',
          outcomePrices: [
            { outcome: 'Yes', price: 0.80 },
            { outcome: 'No', price: 0.20 },
          ],
        }),
      ],
      { forecastMean: 0, forecastStdDev: 0 },
    );

    expect(result.kind).toBe('abstain');
    if (result.kind === 'abstain') {
      expect(result.reason).toBe('no_high_yes_bucket');
    }
  });

  it('single-bucket evaluate applies the maxYesPrice ceiling', async () => {
    const strategy = new WeatherHighestYesStrategy();
    strategy.setRiskConfig({ minYesPrice: 0.5, maxYesPrice: 0.6 } as never);

    const result = await strategy.evaluate(
      market({
        outcomePrices: [
          { outcome: 'Yes', price: 0.80 },
          { outcome: 'No', price: 0.20 },
        ],
      }),
      { forecastMean: 0, forecastStdDev: 0 },
    );

    expect(result.kind).toBe('abstain');
    if (result.kind === 'abstain') {
      expect(result.reason).toBe('yes_price_above_max');
    }
  });

  it('abstains when no bucket has a valid YES price', async () => {
    const strategy = new WeatherHighestYesStrategy();
    strategy.setRiskConfig({ minYesPrice: 0.5 } as never);

    const result = await strategy.evaluateGroup(
      [
        market({
          conditionId: 'no-prices',
          outcomePrices: [],
        }),
      ],
      { forecastMean: 0, forecastStdDev: 0 },
    );

    expect(result.kind).toBe('abstain');
    if (result.kind === 'abstain') {
      expect(result.reason).toBe('no_high_yes_bucket');
    }
  });

  it('clamps confidence to 1 even if YES price exceeds 1', async () => {
    const strategy = new WeatherHighestYesStrategy();
    strategy.setRiskConfig({ minYesPrice: 0.5 } as never);

    const result = await strategy.evaluate(
      market({
        outcomePrices: [
          { outcome: 'Yes', price: 1.2 },
          { outcome: 'No', price: -0.2 },
        ],
      }),
      { forecastMean: 0, forecastStdDev: 0 },
    );

    expect(result.kind).toBe('signal');
    if (result.kind === 'signal') {
      expect(result.signal.confidence).toBe(1);
    }
  });

  it('single-bucket evaluate applies the minYesPrice gate', async () => {
    const strategy = new WeatherHighestYesStrategy();
    strategy.setRiskConfig({ minYesPrice: 0.7 } as never);

    const result = await strategy.evaluate(
      market({
        outcomePrices: [
          { outcome: 'Yes', price: 0.6 },
          { outcome: 'No', price: 0.4 },
        ],
      }),
      { forecastMean: 0, forecastStdDev: 0 },
    );

    expect(result.kind).toBe('abstain');
    if (result.kind === 'abstain') {
      expect(result.reason).toBe('yes_price_below_min');
    }
  });

  it('abstains with missing_token when tokenIdYes is null', async () => {
    const strategy = new WeatherHighestYesStrategy();
    strategy.setRiskConfig({ minYesPrice: 0.5 } as never);

    const result = await strategy.evaluate(
      market({
        tokenIdYes: null,
        outcomePrices: [
          { outcome: 'Yes', price: 0.7 },
          { outcome: 'No', price: 0.3 },
        ],
      }),
      { forecastMean: 0, forecastStdDev: 0 },
    );

    expect(result.kind).toBe('abstain');
    if (result.kind === 'abstain') {
      expect(result.reason).toBe('missing_token');
    }
  });

  describe('allowedComparisons filter', () => {
    it('regression #2: excludes or_above buckets when allowedComparisons = [exact, between]', async () => {
      const strategy = new WeatherHighestYesStrategy();
      strategy.setRiskConfig({
        minYesPrice: 0.5,
        allowedComparisons: ['exact', 'between'],
      } as never);

      // or_above bucket has a mechanically higher YES price (P(T >= 24)) but
      // is excluded by the filter → the exact bucket wins despite a lower price.
      const result = await strategy.evaluateGroup(
        [
          market({
            conditionId: 'exact-24',
            question: 'Will the highest temperature in Paris be 24°C on July 30?',
            outcomePrices: [
              { outcome: 'Yes', price: 0.60 },
              { outcome: 'No', price: 0.40 },
            ],
          }),
          market({
            conditionId: 'or-above-24',
            question: 'Will the highest temperature in Paris be 24°C or above on July 30?',
            outcomePrices: [
              { outcome: 'Yes', price: 0.80 },
              { outcome: 'No', price: 0.20 },
            ],
          }),
        ],
        { forecastMean: 0, forecastStdDev: 0 },
      );

      expect(result.kind).toBe('signal');
      if (result.kind === 'signal') {
        expect(result.signal.conditionId).toBe('exact-24');
      }
    });

    it('abstains when all buckets are filtered out', async () => {
      const strategy = new WeatherHighestYesStrategy();
      strategy.setRiskConfig({
        minYesPrice: 0.5,
        allowedComparisons: ['between'],
      } as never);

      const result = await strategy.evaluateGroup(
        [
          market({
            conditionId: 'exact-24',
            question: 'Will the highest temperature in Paris be 24°C on July 30?',
            outcomePrices: [
              { outcome: 'Yes', price: 0.80 },
              { outcome: 'No', price: 0.20 },
            ],
          }),
        ],
        { forecastMean: 0, forecastStdDev: 0 },
      );

      expect(result.kind).toBe('abstain');
      if (result.kind === 'abstain') {
        expect(result.reason).toBe('no_high_yes_bucket');
      }
    });

    it('null/empty allowedComparisons accepts all (backward compatible)', async () => {
      const strategy = new WeatherHighestYesStrategy();
      strategy.setRiskConfig({ minYesPrice: 0.5, allowedComparisons: null } as never);

      const result = await strategy.evaluateGroup(
        [
          market({
            conditionId: 'or-above-24',
            question: 'Will the highest temperature in Paris be 24°C or above on July 30?',
            outcomePrices: [
              { outcome: 'Yes', price: 0.80 },
              { outcome: 'No', price: 0.20 },
            ],
          }),
        ],
        { forecastMean: 0, forecastStdDev: 0 },
      );

      expect(result.kind).toBe('signal');
      if (result.kind === 'signal') {
        expect(result.signal.conditionId).toBe('or-above-24');
      }
    });

    it('evaluate abstains with comparison_not_allowed when the bucket is filtered', async () => {
      const strategy = new WeatherHighestYesStrategy();
      strategy.setRiskConfig({
        minYesPrice: 0.5,
        allowedComparisons: ['exact'],
      } as never);

      const result = await strategy.evaluate(
        market({
          question: 'Will the highest temperature in Paris be 24°C or above on July 30?',
          outcomePrices: [
            { outcome: 'Yes', price: 0.80 },
            { outcome: 'No', price: 0.20 },
          ],
        }),
        { forecastMean: 0, forecastStdDev: 0 },
      );

      expect(result.kind).toBe('abstain');
      if (result.kind === 'abstain') {
        expect(result.reason).toBe('comparison_not_allowed');
      }
    });
  });
});
