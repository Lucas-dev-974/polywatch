import { describe, expect, it } from 'vitest';
import {
  getStrategyParams,
  sanitizeWeatherStrategyParams,
  validateWeatherStrategyParamsUpdate,
  parseWeatherAlgoStrategies,
  WEATHER_FORECAST_STRATEGY_ID,
} from './strategy-catalog.js';

describe('strategy-catalog', () => {
  it('parseWeatherAlgoStrategies falls back to default on invalid JSON', () => {
    expect(parseWeatherAlgoStrategies('not-json')).toEqual([WEATHER_FORECAST_STRATEGY_ID]);
  });

  it('getStrategyParams overlays stored bag over catalogue defaults', () => {
    const params = getStrategyParams(
      {
        weatherAlgoStrategyParams: JSON.stringify({
          'weather-forecast': { minEdge: 0.2 },
        }),
      },
      'weather-forecast',
    );
    expect(params.minEdge).toBe(0.2);
    expect(params.maxForecastStd).toBeNull();
    expect(params.entryUsdc).toBe(10);
    expect(params.maxOpenPositions).toBe(10);
  });

  it('getStrategyParams coerces stored 0 to null for nullable knobs', () => {
    const params = getStrategyParams(
      {
        weatherAlgoStrategyParams: JSON.stringify({
          'weather-forecast': {
            maxForecastStd: 0,
            minForecastProbability: 0,
            slBidPoints: 0,
            tpBidPoints: 0,
            trailingBidPoints: 0,
            trailingActivationBidPoints: 0,
          },
        }),
      },
      'weather-forecast',
    );
    expect(params.maxForecastStd).toBeNull();
    expect(params.minForecastProbability).toBeNull();
    expect(params.slBidPoints).toBeNull();
    expect(params.tpBidPoints).toBeNull();
    expect(params.trailingBidPoints).toBeNull();
    expect(params.trailingActivationBidPoints).toBeNull();
  });

  it('getStrategyParams keeps non-nullable 0 values untouched', () => {
    const params = getStrategyParams(
      {
        weatherAlgoStrategyParams: JSON.stringify({
          'weather-forecast': { minTimeToClose: 0, entryDepthRetryMax: 0 },
        }),
      },
      'weather-forecast',
    );
    expect(params.minTimeToClose).toBe(0);
    expect(params.entryDepthRetryMax).toBe(0);
  });

  it('sanitizeWeatherStrategyParams keeps allowedMarketTags (bag key without UI schema)', () => {
    const out = sanitizeWeatherStrategyParams({
      'weather-forecast': { allowedMarketTags: ['sports', 'politics'] },
    });
    expect(out['weather-forecast']?.allowedMarketTags).toEqual(['sports', 'politics']);
  });

  it('sanitizeWeatherStrategyParams strips retired / unknown keys', () => {
    expect(
      sanitizeWeatherStrategyParams({
        'weather-forecast': { useGlobalMinEdge: false },
        'unknown-strategy': { x: 1 },
      }),
    ).toEqual({});
  });

  it('validateWeatherStrategyParamsUpdate rejects unknown strategy id in list', () => {
    const errors = validateWeatherStrategyParamsUpdate(['unknown-strategy'], {});
    expect(errors.some((e) => e.message.includes('unknown strategy id'))).toBe(true);
  });

  it('validateWeatherStrategyParamsUpdate ignores unknown param keys after sanitize', () => {
    const errors = validateWeatherStrategyParamsUpdate(
      [WEATHER_FORECAST_STRATEGY_ID],
      { 'weather-forecast': { useGlobalMinEdge: false } },
    );
    expect(errors).toEqual([]);
  });
});
