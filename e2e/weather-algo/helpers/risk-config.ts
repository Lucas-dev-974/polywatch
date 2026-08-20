import type { DataSource } from 'typeorm';
import {
  WeatherConfig,
  DEFAULT_WEATHER_STRATEGY_PARAMS,
  serializeWeatherAlgoStrategyParams,
} from '@polywatch/core';

export async function configureWeatherAlgoRisk(
  ds: DataSource,
  overrides?: Partial<WeatherConfig>,
): Promise<WeatherConfig> {
  const repo = ds.getRepository(WeatherConfig);
  const existing = (await repo.findOne({ where: {} })) ?? repo.create({});
  existing.weatherAlgoEnabled = true;
  existing.weatherAlgoSimEnabled = true;
  existing.weatherAlgoRealEnabled = false;
  existing.weatherAlgoSelectionMode = 'single';
  existing.weatherAlgoMaxSignalsPerEvent = 3;
  existing.simInitialCapitalWeather = 10_000;
  existing.weatherAlgoStrategies = JSON.stringify(['weather-forecast']);
  existing.weatherAlgoStrategyParams = serializeWeatherAlgoStrategyParams({
    'weather-forecast': {
      ...DEFAULT_WEATHER_STRATEGY_PARAMS,
      minEdge: 0.05,
      entryUsdc: 10,
    },
  });
  Object.assign(existing, overrides ?? {});
  return repo.save(existing);
}
