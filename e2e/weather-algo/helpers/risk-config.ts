import type { DataSource } from 'typeorm';
import { WeatherConfig } from '@polywatch/core';

export async function configureWeatherAlgoRisk(
  ds: DataSource,
  overrides?: Partial<WeatherConfig>,
): Promise<WeatherConfig> {
  const repo = ds.getRepository(WeatherConfig);
  const existing = (await repo.findOne({ where: {} })) ?? repo.create({});
  existing.weatherAlgoEnabled = true;
  existing.weatherAlgoSimEnabled = true;
  existing.weatherAlgoRealEnabled = false;
  existing.weatherAlgoMinEdge = 0.05;
  existing.weatherAlgoMaxForecastStd = null;
  existing.weatherAlgoEntryUsdc = 10;
  existing.weatherAlgoCloseBeforeResolutionHours = 1;
  existing.weatherAlgoSizingMode = 'fixed_usdc';
  existing.weatherAlgoSelectionMode = 'single';
  existing.weatherAlgoMaxSignalsPerEvent = 3;
  existing.simInitialCapitalWeather = 10_000;
  Object.assign(existing, overrides ?? {});
  return repo.save(existing);
}
