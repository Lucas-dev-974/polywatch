import { describe, expect, it } from 'vitest';
import {
  presentWeatherConfigForApi,
  toWeatherConfigEntityUpdate,
} from './weather-config-api.js';
import type { WeatherConfig } from '../entities/WeatherConfig.js';

function baseConfig(overrides: Partial<WeatherConfig> = {}): WeatherConfig {
  return {
    id: 1,
    weatherAlgoAllowedMarketTags: '["weather"]',
    weatherAlgoEnabled: true,
    ...overrides,
  } as WeatherConfig;
}

describe('weather-config-api', () => {
  it('presents allowed market tags as string[]', () => {
    const presented = presentWeatherConfigForApi(baseConfig());
    expect(presented.weatherAlgoAllowedMarketTags).toEqual(['weather']);
  });

  it('serializes allowed market tags on update', () => {
    const update = toWeatherConfigEntityUpdate({
      weatherAlgoEnabled: false,
      weatherAlgoAllowedMarketTags: ['weather', 'climate'],
    });
    expect(update.weatherAlgoEnabled).toBe(false);
    expect(update.weatherAlgoAllowedMarketTags).toBe('["weather","climate"]');
  });

  it('does not double-encode tags that are already a JSON string', () => {
    const update = toWeatherConfigEntityUpdate({
      weatherAlgoAllowedMarketTags: '["weather"]',
    });
    expect(update.weatherAlgoAllowedMarketTags).toBe('["weather"]');
  });

  it('presents the 4 per-env fields as parsed arrays/maps, not raw strings', () => {
    const presented = presentWeatherConfigForApi(
      baseConfig({
        simWeatherAlgoStrategies: '["weather-forecast"]',
        realWeatherAlgoStrategies: '["weather-highest-yes"]',
        simWeatherAlgoStrategyParams: '{"weather-forecast":{"minEdge":0.2}}',
        realWeatherAlgoStrategyParams: '{}',
        weatherAlgoStrategies: '["weather-forecast"]',
        weatherAlgoStrategyParams: '{}',
      }),
    );
    expect(presented.simWeatherAlgoStrategies).toEqual(['weather-forecast']);
    expect(presented.realWeatherAlgoStrategies).toEqual(['weather-highest-yes']);
    expect(presented.simWeatherAlgoStrategyParams['weather-forecast']?.minEdge).toBe(0.2);
    expect(typeof presented.simWeatherAlgoStrategies).not.toBe('string');
  });

  it('never writes legacy weatherAlgoStrategies / weatherAlgoStrategyParams', () => {
    const update = toWeatherConfigEntityUpdate({
      weatherAlgoStrategies: ['weather-highest-yes'],
      weatherAlgoStrategyParams: { 'weather-forecast': { minEdge: 0.2 } },
      simWeatherAlgoStrategies: ['weather-forecast'],
      realWeatherAlgoStrategies: ['weather-highest-yes'],
    });
    expect(update).not.toHaveProperty('weatherAlgoStrategies');
    expect(update).not.toHaveProperty('weatherAlgoStrategyParams');
    expect(update.simWeatherAlgoStrategies).toBe('["weather-forecast"]');
    expect(update.realWeatherAlgoStrategies).toBe('["weather-highest-yes"]');
  });
});
