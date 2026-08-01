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
});
