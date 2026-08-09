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

  it('getStrategyParams returns empty object when catalogue has no params', () => {
    const params = getStrategyParams(
      {
        weatherAlgoStrategyParams: JSON.stringify({
          'weather-forecast': { leftover: 1 },
        }),
      },
      'weather-forecast',
    );
    expect(params).toEqual({});
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
