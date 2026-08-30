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
  clampEnabledWeatherStrategies,
  isKnownWeatherStrategyId,
  type WeatherStrategyParamsMap,
  type WeatherStrategyId,
} from '../weather/strategy-catalog.js';

export type WeatherConfigApi = Omit<
  WeatherConfig,
  | 'weatherAlgoAllowedMarketTags'
  | 'weatherAlgoStrategies'
  | 'weatherAlgoStrategyParams'
  | 'simWeatherAlgoStrategies'
  | 'realWeatherAlgoStrategies'
  | 'simWeatherAlgoStrategyParams'
  | 'realWeatherAlgoStrategyParams'
> & {
  weatherAlgoAllowedMarketTags: string[];
  weatherAlgoStrategies: WeatherStrategyId[];
  weatherAlgoStrategyParams: WeatherStrategyParamsMap;
  simWeatherAlgoStrategies: WeatherStrategyId[];
  realWeatherAlgoStrategies: WeatherStrategyId[];
  simWeatherAlgoStrategyParams: WeatherStrategyParamsMap;
  realWeatherAlgoStrategyParams: WeatherStrategyParamsMap;
};

type WeatherTagsUpdate = {
  weatherAlgoAllowedMarketTags?: string[] | string;
};

type WeatherStrategiesUpdate = {
  weatherAlgoStrategies?: WeatherStrategyId[] | string;
  weatherAlgoStrategyParams?: WeatherStrategyParamsMap | string;
  simWeatherAlgoStrategies?: WeatherStrategyId[] | string;
  realWeatherAlgoStrategies?: WeatherStrategyId[] | string;
  simWeatherAlgoStrategyParams?: WeatherStrategyParamsMap | string;
  realWeatherAlgoStrategyParams?: WeatherStrategyParamsMap | string;
};


function serializeClampedWeatherAlgoStrategies(
  ids: WeatherStrategyId[] | string,
): string {
  const parsed =
    typeof ids === 'string'
      ? parseWeatherAlgoStrategies(ids)
      : ids.filter((x): x is WeatherStrategyId => isKnownWeatherStrategyId(String(x)));
  const clamped = clampEnabledWeatherStrategies(
    parsed.length > 0 ? parsed : parseWeatherAlgoStrategies('[]'),
  ).enabled;
  return serializeWeatherAlgoStrategies(clamped);
}

export function presentWeatherConfigForApi(config: WeatherConfig): WeatherConfigApi {
  return {
    ...config,
    weatherAlgoAllowedMarketTags: parseAllowedMarketTags(config.weatherAlgoAllowedMarketTags),
    weatherAlgoStrategies: clampEnabledWeatherStrategies(
      parseWeatherAlgoStrategies(config.weatherAlgoStrategies),
    ).enabled,
    weatherAlgoStrategyParams: parseWeatherAlgoStrategyParams(config.weatherAlgoStrategyParams),
    simWeatherAlgoStrategies: clampEnabledWeatherStrategies(
      parseWeatherAlgoStrategies(config.simWeatherAlgoStrategies),
    ).enabled,
    realWeatherAlgoStrategies: clampEnabledWeatherStrategies(
      parseWeatherAlgoStrategies(config.realWeatherAlgoStrategies),
    ).enabled,
    simWeatherAlgoStrategyParams: parseWeatherAlgoStrategyParams(
      config.simWeatherAlgoStrategyParams,
    ),
    realWeatherAlgoStrategyParams: parseWeatherAlgoStrategyParams(
      config.realWeatherAlgoStrategyParams,
    ),
  };
}

export function toWeatherConfigEntityUpdate<T extends WeatherTagsUpdate & WeatherStrategiesUpdate>(
  data: T,
): Omit<T, keyof WeatherTagsUpdate | keyof WeatherStrategiesUpdate> & Partial<WeatherConfig> {
  const {
    weatherAlgoAllowedMarketTags,
    weatherAlgoStrategies,
    weatherAlgoStrategyParams,
    simWeatherAlgoStrategies,
    realWeatherAlgoStrategies,
    simWeatherAlgoStrategyParams,
    realWeatherAlgoStrategyParams,
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

  // Colonnes legacy : lues par le GET mais plus jamais écrites par le backend.
  // Elles sont retirées du patch même si présentes dans l'input.
  void weatherAlgoStrategies;
  void weatherAlgoStrategyParams;

  if (simWeatherAlgoStrategies !== undefined) {
    update.simWeatherAlgoStrategies = serializeClampedWeatherAlgoStrategies(
      simWeatherAlgoStrategies,
    );
  }

  if (realWeatherAlgoStrategies !== undefined) {
    update.realWeatherAlgoStrategies = serializeClampedWeatherAlgoStrategies(
      realWeatherAlgoStrategies,
    );
  }

  if (simWeatherAlgoStrategyParams !== undefined) {
    if (typeof simWeatherAlgoStrategyParams === 'string') {
      update.simWeatherAlgoStrategyParams = simWeatherAlgoStrategyParams;
    } else {
      update.simWeatherAlgoStrategyParams = serializeWeatherAlgoStrategyParams(
        simWeatherAlgoStrategyParams,
      );
    }
  }

  if (realWeatherAlgoStrategyParams !== undefined) {
    if (typeof realWeatherAlgoStrategyParams === 'string') {
      update.realWeatherAlgoStrategyParams = realWeatherAlgoStrategyParams;
    } else {
      update.realWeatherAlgoStrategyParams = serializeWeatherAlgoStrategyParams(
        realWeatherAlgoStrategyParams,
      );
    }
  }

  return update as Omit<T, keyof WeatherTagsUpdate | keyof WeatherStrategiesUpdate> &
    Partial<WeatherConfig>;
}
