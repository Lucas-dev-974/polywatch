import type { WeatherConfig } from '../entities/WeatherConfig.js';
import {
  parseAllowedMarketTags,
  serializeAllowedMarketTags,
} from '../market/tags.js';

export type WeatherConfigApi = Omit<WeatherConfig, 'weatherAlgoAllowedMarketTags'> & {
  weatherAlgoAllowedMarketTags: string[];
};

type WeatherTagsUpdate = {
  weatherAlgoAllowedMarketTags?: string[] | string;
};

export function presentWeatherConfigForApi(config: WeatherConfig): WeatherConfigApi {
  return {
    ...config,
    weatherAlgoAllowedMarketTags: parseAllowedMarketTags(config.weatherAlgoAllowedMarketTags),
  };
}

export function toWeatherConfigEntityUpdate<T extends WeatherTagsUpdate>(
  data: T,
): Omit<T, keyof WeatherTagsUpdate> & Partial<WeatherConfig> {
  const { weatherAlgoAllowedMarketTags, ...rest } = data;
  const update: Partial<WeatherConfig> = { ...rest };

  if (weatherAlgoAllowedMarketTags !== undefined) {
    if (typeof weatherAlgoAllowedMarketTags === 'string') {
      // Already serialized JSON (legacy / Object.assign path) — keep as-is.
      update.weatherAlgoAllowedMarketTags = weatherAlgoAllowedMarketTags;
    } else {
      update.weatherAlgoAllowedMarketTags = serializeAllowedMarketTags(
        weatherAlgoAllowedMarketTags,
      );
    }
  }

  return update as Omit<T, keyof WeatherTagsUpdate> & Partial<WeatherConfig>;
}
