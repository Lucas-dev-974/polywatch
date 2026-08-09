import type { WeatherConfig } from '../entities/WeatherConfig.js';
import {
  parseAllowedMarketTags,
  serializeAllowedMarketTags,
} from '../market/tags.js';
import {
  parseWeatherAlgoStrategies,
  parseWeatherAlgoStrategyParams,
  serializeWeatherAlgoStrategies,
  serializeWeatherAlgoStrategyParams,
  type WeatherStrategyParamsMap,
  type WeatherStrategyId,
} from '../weather/strategy-catalog.js';

export type WeatherConfigApi = Omit<
  WeatherConfig,
  'weatherAlgoAllowedMarketTags' | 'weatherAlgoStrategies' | 'weatherAlgoStrategyParams'
> & {
  weatherAlgoAllowedMarketTags: string[];
  weatherAlgoStrategies: WeatherStrategyId[];
  weatherAlgoStrategyParams: WeatherStrategyParamsMap;
};

type WeatherTagsUpdate = {
  weatherAlgoAllowedMarketTags?: string[] | string;
};

type WeatherStrategiesUpdate = {
  weatherAlgoStrategies?: WeatherStrategyId[] | string;
  weatherAlgoStrategyParams?: WeatherStrategyParamsMap | string;
};

export function presentWeatherConfigForApi(config: WeatherConfig): WeatherConfigApi {
  return {
    ...config,
    weatherAlgoAllowedMarketTags: parseAllowedMarketTags(config.weatherAlgoAllowedMarketTags),
    weatherAlgoStrategies: parseWeatherAlgoStrategies(config.weatherAlgoStrategies),
    weatherAlgoStrategyParams: parseWeatherAlgoStrategyParams(config.weatherAlgoStrategyParams),
  };
}

export function toWeatherConfigEntityUpdate<T extends WeatherTagsUpdate & WeatherStrategiesUpdate>(
  data: T,
): Omit<T, keyof WeatherTagsUpdate | keyof WeatherStrategiesUpdate> & Partial<WeatherConfig> {
  const {
    weatherAlgoAllowedMarketTags,
    weatherAlgoStrategies,
    weatherAlgoStrategyParams,
    ...rest
  } = data;
  const update: Partial<WeatherConfig> = { ...rest };

  if (weatherAlgoAllowedMarketTags !== undefined) {
    if (typeof weatherAlgoAllowedMarketTags === 'string') {
      update.weatherAlgoAllowedMarketTags = weatherAlgoAllowedMarketTags;
    } else {
      update.weatherAlgoAllowedMarketTags = serializeAllowedMarketTags(
        weatherAlgoAllowedMarketTags,
      );
    }
  }

  if (weatherAlgoStrategies !== undefined) {
    if (typeof weatherAlgoStrategies === 'string') {
      update.weatherAlgoStrategies = weatherAlgoStrategies;
    } else {
      update.weatherAlgoStrategies = serializeWeatherAlgoStrategies(weatherAlgoStrategies);
    }
  }

  if (weatherAlgoStrategyParams !== undefined) {
    if (typeof weatherAlgoStrategyParams === 'string') {
      update.weatherAlgoStrategyParams = weatherAlgoStrategyParams;
    } else {
      update.weatherAlgoStrategyParams = serializeWeatherAlgoStrategyParams(
        weatherAlgoStrategyParams,
      );
    }
  }

  return update as Omit<T, keyof WeatherTagsUpdate | keyof WeatherStrategiesUpdate> &
    Partial<WeatherConfig>;
}
