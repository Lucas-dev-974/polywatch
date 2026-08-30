import { describe, expect, it } from 'vitest';
import {
  getStrategyParams,
  getStrategyParamsForMode,
  resolveEnabledWeatherStrategiesForMode,
  clampEnabledWeatherStrategies,
  parseWeatherAlgoStrategyParams,
  sanitizeWeatherStrategyParams,
  validateWeatherStrategyParamsUpdate,
  parseWeatherAlgoStrategies,
  WEATHER_FORECAST_STRATEGY_ID,
  WEATHER_FORECAST_ALIGNED_STRATEGY_ID,
  WEATHER_HIGHEST_YES_STRATEGY_ID,
  WEATHER_STRATEGY_IDS,
  isKnownWeatherStrategyId,
  type WeatherStrategyParamsMap,
} from './strategy-catalog.js';

describe('strategy-catalog', () => {
  it('registers weather-highest-yes in WEATHER_STRATEGY_IDS and isKnownWeatherStrategyId', () => {
    expect(WEATHER_STRATEGY_IDS).toContain(WEATHER_HIGHEST_YES_STRATEGY_ID);
    expect(isKnownWeatherStrategyId(WEATHER_HIGHEST_YES_STRATEGY_ID)).toBe(true);
  });

  it('getStrategyParams returns minYesPrice default for highest-yes', () => {
    const params = getStrategyParams({}, WEATHER_HIGHEST_YES_STRATEGY_ID);
    expect(params.minYesPrice).toBe(0.5);
    expect(params.maxYesPrice).toBeNull();
  });

  it('getStrategyParams overlays stored maxYesPrice and coerces 0 to null', () => {
    const params = getStrategyParams(
      {
        weatherAlgoStrategyParams: JSON.stringify({
          [WEATHER_HIGHEST_YES_STRATEGY_ID]: { maxYesPrice: 0.7 },
        }),
      },
      WEATHER_HIGHEST_YES_STRATEGY_ID,
    );
    expect(params.maxYesPrice).toBe(0.7);

    const disabled = getStrategyParams(
      {
        weatherAlgoStrategyParams: JSON.stringify({
          [WEATHER_HIGHEST_YES_STRATEGY_ID]: { maxYesPrice: 0 },
        }),
      },
      WEATHER_HIGHEST_YES_STRATEGY_ID,
    );
    expect(disabled.maxYesPrice).toBeNull();
  });

  it('getStrategyParams overlays stored minYesPrice for highest-yes', () => {
    const params = getStrategyParams(
      {
        weatherAlgoStrategyParams: JSON.stringify({
          [WEATHER_HIGHEST_YES_STRATEGY_ID]: { minYesPrice: 0.7 },
        }),
      },
      WEATHER_HIGHEST_YES_STRATEGY_ID,
    );
    expect(params.minYesPrice).toBe(0.7);
  });

  it('getStrategyParams falls back to default when stored minYesPrice is null', () => {
    // Un `null` stocké ne doit pas désactiver le plancher : il retombe sur le
    // défaut 0.5 (sinon les prix YES quasi nuls passent — bug run #40).
    const params = getStrategyParams(
      {
        weatherAlgoStrategyParams: JSON.stringify({
          [WEATHER_HIGHEST_YES_STRATEGY_ID]: { minYesPrice: null },
        }),
      },
      WEATHER_HIGHEST_YES_STRATEGY_ID,
    );
    expect(params.minYesPrice).toBe(0.5);
  });

  it('getStrategyParams falls back to default when stored entryPusd is null', () => {
    const params = getStrategyParams(
      {
        weatherAlgoStrategyParams: JSON.stringify({
          'weather-forecast': { entryPusd: null },
        }),
      },
      'weather-forecast',
    );
    expect(params.entryPusd).toBe(10);
  });
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
    expect(params.entryPusd).toBe(10);
    expect(params.maxOpenPositions).toBe(10);
  });

  it('getStrategyParams coerces stored 0 to null for nullable knobs', () => {
    const params = getStrategyParams(
      {
        weatherAlgoStrategyParams: JSON.stringify({
          'weather-forecast': {
            maxForecastStd: 0,
            minForecastProbability: 0,
            slPercent: 0,
            tpPercent: 0,
            trailingPercent: 0,
            trailingActivationPercent: 0,
          },
        }),
      },
      'weather-forecast',
    );
    expect(params.maxForecastStd).toBeNull();
    expect(params.minForecastProbability).toBeNull();
    expect(params.slPercent).toBeNull();
    expect(params.tpPercent).toBeNull();
    expect(params.trailingPercent).toBeNull();
    expect(params.trailingActivationPercent).toBeNull();
  });

  it('getStrategyParams keeps non-nullable 0 values untouched', () => {
    const params = getStrategyParams(
      {
        weatherAlgoStrategyParams: JSON.stringify({
          'weather-forecast': { minAskDepthShares: 0, entryDepthRetryMax: 0 },
        }),
      },
      'weather-forecast',
    );
    expect(params.minAskDepthShares).toBe(0);
    expect(params.entryDepthRetryMax).toBe(0);
  });

  it('getStrategyParams exposes minAskDepthShares and entryTickPad defaults', () => {
    const params = getStrategyParams({}, 'weather-forecast');
    expect(params.minAskDepthShares).toBe(0);
    expect(params.entryTickPad).toBe(1);
  });

  it('getStrategyParams overlays stored minAskDepthShares and entryTickPad', () => {
    const params = getStrategyParams(
      {
        weatherAlgoStrategyParams: JSON.stringify({
          'weather-forecast': { minAskDepthShares: 300, entryTickPad: 2 },
        }),
      },
      'weather-forecast',
    );
    expect(params.minAskDepthShares).toBe(300);
    expect(params.entryTickPad).toBe(2);
  });

  it('validateWeatherStrategyParamsUpdate accepts minAskDepthShares and entryTickPad', () => {
    const errors = validateWeatherStrategyParamsUpdate(
      [WEATHER_FORECAST_STRATEGY_ID],
      { 'weather-forecast': { minAskDepthShares: 300, entryTickPad: 2 } },
    );
    expect(errors).toEqual([]);
  });

  it('sanitizeWeatherStrategyParams strips retired unused knobs', () => {
    const out = sanitizeWeatherStrategyParams({
      'weather-forecast': {
        allowedMarketTags: ['sports', 'politics'],
        minBidToAskRatio: 0.9,
        minTimeToClose: 30,
        entryTickPad: 2,
      } as never,
    });
    expect(out['weather-forecast']?.allowedMarketTags).toBeUndefined();
    expect(out['weather-forecast']?.minBidToAskRatio).toBeUndefined();
    expect(out['weather-forecast']?.minTimeToClose).toBeUndefined();
    expect(out['weather-forecast']?.entryTickPad).toBe(2);
  });

  it('sanitizeWeatherStrategyParams strips retired / unknown keys', () => {
    expect(
      sanitizeWeatherStrategyParams({
        'weather-forecast': { useGlobalMinEdge: false },
        'unknown-strategy': { x: 1 },
      }),
    ).toEqual({});
  });

  it('parseWeatherAlgoStrategyParams migrates legacy *Usdc keys and fixed_usdc', () => {
    const parsed = parseWeatherAlgoStrategyParams(
      JSON.stringify({
        'weather-forecast': {
          entryUsdc: 25,
          maxExposureUsdc: 400,
          maxDailyLossUsdc: 50,
          maxPositionSizeUsdc: 80,
          sizingMode: 'fixed_usdc',
          minEdge: 0.12,
        },
      }),
    );
    expect(parsed['weather-forecast']).toMatchObject({
      entryPusd: 25,
      maxExposurePusd: 400,
      maxDailyLossPusd: 50,
      maxPositionSizePusd: 80,
      sizingMode: 'fixed_pusd',
      minEdge: 0.12,
    });
    expect(parsed['weather-forecast']).not.toHaveProperty('entryUsdc');
  });

  it('getStrategyParams prefers already-renamed *Pusd keys over legacy *Usdc', () => {
    const params = getStrategyParams(
      {
        weatherAlgoStrategyParams: JSON.stringify({
          'weather-forecast': { entryPusd: 15, entryUsdc: 99, sizingMode: 'fixed_usdc' },
        }),
      },
      'weather-forecast',
    );
    expect(params.entryPusd).toBe(15);
    expect(params.sizingMode).toBe('fixed_pusd');
  });

  it('sanitizeWeatherStrategyParams heals legacy keys instead of dropping them', () => {
    const out = sanitizeWeatherStrategyParams({
      'weather-forecast': { entryUsdc: 30, sizingMode: 'fixed_usdc' },
    } as unknown as WeatherStrategyParamsMap);
    expect(out['weather-forecast']?.entryPusd).toBe(30);
    expect(out['weather-forecast']?.sizingMode).toBe('fixed_pusd');
    expect(out['weather-forecast']).not.toHaveProperty('entryUsdc');
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

  it('validateWeatherStrategyParamsUpdate accepts null for nullable numeric knobs', () => {
    const errors = validateWeatherStrategyParamsUpdate(
      [WEATHER_HIGHEST_YES_STRATEGY_ID, WEATHER_FORECAST_STRATEGY_ID],
      {
        'weather-highest-yes': { maxYesPrice: null },
        'weather-forecast': { slPercent: null, maxForecastStd: null },
      },
    );
    expect(errors).toEqual([]);
  });

  it('validateWeatherStrategyParamsUpdate still rejects null for non-nullable knobs', () => {
    const errors = validateWeatherStrategyParamsUpdate(
      [WEATHER_FORECAST_STRATEGY_ID],
      { 'weather-forecast': { minEdge: null } },
    );
    expect(errors.some((e) => e.key === 'minEdge' && e.message === 'expected number')).toBe(true);
  });
});

describe('resolveEnabledWeatherStrategiesForMode / getStrategyParamsForMode', () => {
  it('falls back to legacy when the per-env raw value is undefined / null / empty', () => {
    const config = {
      weatherAlgoStrategies: JSON.stringify([WEATHER_HIGHEST_YES_STRATEGY_ID]),
      weatherAlgoStrategyParams: JSON.stringify({
        [WEATHER_HIGHEST_YES_STRATEGY_ID]: { minYesPrice: 0.7 },
      }),
      simWeatherAlgoStrategies: undefined,
      realWeatherAlgoStrategies: '',
      simWeatherAlgoStrategyParams: undefined,
      realWeatherAlgoStrategyParams: null,
    } as never;

    expect(resolveEnabledWeatherStrategiesForMode(config, 'sim')).toEqual([
      WEATHER_HIGHEST_YES_STRATEGY_ID,
    ]);
    expect(resolveEnabledWeatherStrategiesForMode(config, 'real')).toEqual([
      WEATHER_HIGHEST_YES_STRATEGY_ID,
    ]);
    expect(getStrategyParamsForMode(config, WEATHER_HIGHEST_YES_STRATEGY_ID, 'sim').minYesPrice).toBe(
      0.7,
    );
    expect(getStrategyParamsForMode(config, WEATHER_HIGHEST_YES_STRATEGY_ID, 'real').minYesPrice).toBe(
      0.7,
    );
  });

  it('does not fall back to legacy when the per-env column is populated (including [])', () => {
    const config = {
      weatherAlgoStrategies: JSON.stringify([WEATHER_HIGHEST_YES_STRATEGY_ID]),
      weatherAlgoStrategyParams: JSON.stringify({
        [WEATHER_FORECAST_STRATEGY_ID]: { minEdge: 0.3 },
      }),
      simWeatherAlgoStrategies: JSON.stringify([WEATHER_FORECAST_ALIGNED_STRATEGY_ID]),
      realWeatherAlgoStrategies: '[]',
      simWeatherAlgoStrategyParams: JSON.stringify({
        [WEATHER_FORECAST_STRATEGY_ID]: { minEdge: 0.15 },
      }),
      realWeatherAlgoStrategyParams: '{}',
    } as never;

    expect(resolveEnabledWeatherStrategiesForMode(config, 'sim')).toEqual([
      WEATHER_FORECAST_ALIGNED_STRATEGY_ID,
    ]);
    // '[]' is populated — parseWeatherAlgoStrategies collapses it to the catalogue
    // default, it must NOT fall back to the legacy highest-yes list.
    expect(resolveEnabledWeatherStrategiesForMode(config, 'real')).toEqual([
      WEATHER_FORECAST_STRATEGY_ID,
    ]);
    expect(getStrategyParamsForMode(config, WEATHER_FORECAST_STRATEGY_ID, 'sim').minEdge).toBe(0.15);
    // '{}' is populated — no fallback to the legacy 0.3.
    expect(getStrategyParamsForMode(config, WEATHER_FORECAST_STRATEGY_ID, 'real').minEdge).toBe(0.1);
  });

  it('clamps a legacy multi-id bag to the first catalogue strategy', () => {
    const config = {
      simWeatherAlgoStrategies: JSON.stringify([
        WEATHER_HIGHEST_YES_STRATEGY_ID,
        WEATHER_FORECAST_STRATEGY_ID,
        WEATHER_FORECAST_ALIGNED_STRATEGY_ID,
      ]),
      realWeatherAlgoStrategies: JSON.stringify([
        WEATHER_FORECAST_ALIGNED_STRATEGY_ID,
        WEATHER_HIGHEST_YES_STRATEGY_ID,
      ]),
    } as never;

    expect(resolveEnabledWeatherStrategiesForMode(config, 'sim')).toEqual([
      WEATHER_FORECAST_STRATEGY_ID,
    ]);
    expect(resolveEnabledWeatherStrategiesForMode(config, 'real')).toEqual([
      WEATHER_FORECAST_ALIGNED_STRATEGY_ID,
    ]);
  });
});

describe('clampEnabledWeatherStrategies', () => {
  it('keeps a uniquely already-enabled strategy even if it is not catalogue-first', () => {
    expect(clampEnabledWeatherStrategies([WEATHER_HIGHEST_YES_STRATEGY_ID])).toEqual({
      enabled: [WEATHER_HIGHEST_YES_STRATEGY_ID],
      dropped: [],
    });
  });

  it('keeps an empty list empty', () => {
    expect(clampEnabledWeatherStrategies([])).toEqual({ enabled: [], dropped: [] });
  });

  it('when several are enabled, keeps the first in catalogue order and drops the rest', () => {
    expect(
      clampEnabledWeatherStrategies([
        WEATHER_HIGHEST_YES_STRATEGY_ID,
        WEATHER_FORECAST_ALIGNED_STRATEGY_ID,
        WEATHER_FORECAST_STRATEGY_ID,
      ]),
    ).toEqual({
      enabled: [WEATHER_FORECAST_STRATEGY_ID],
      dropped: [WEATHER_HIGHEST_YES_STRATEGY_ID, WEATHER_FORECAST_ALIGNED_STRATEGY_ID],
    });
  });

  it('dedupes a repeated unique id without dropping it', () => {
    expect(
      clampEnabledWeatherStrategies([
        WEATHER_HIGHEST_YES_STRATEGY_ID,
        WEATHER_HIGHEST_YES_STRATEGY_ID,
      ]),
    ).toEqual({
      enabled: [WEATHER_HIGHEST_YES_STRATEGY_ID],
      dropped: [],
    });
  });
});
