import pino from 'pino';
import type { WeatherMetric } from './metric.js';

const log = pino({ name: 'core:weather-api-client' });

const OPEN_METEO_FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const OPEN_METEO_GEOCODING_URL = 'https://geocoding-api.open-meteo.com/v1/search';

/** Weather models to query for multi-model uncertainty estimation. */
const WEATHER_MODELS = [
  'gfs_seamless',
  'ecmwf_ifs04',
  'icon_seamless',
  'jma_seamless',
  'meteofrance_seamless',
];

export interface GeocodingResult {
  latitude: number;
  longitude: number;
  city: string;
}

export interface ModelForecast {
  modelName: string;
  value: number;
}

export interface ForecastAggregation {
  forecastMean: number;
  forecastStdDev: number;
  modelValues: Record<string, number>;
}

/** Geocode a city name to lat/lon using Open-Meteo's free geocoding API. */
export async function geocodeCity(city: string): Promise<GeocodingResult | null> {
  const url = `${OPEN_METEO_GEOCODING_URL}?name=${encodeURIComponent(city)}&count=1&language=en&format=json`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      log.warn({ city, status: res.status }, 'geocoding failed');
      return null;
    }
    const data = (await res.json()) as {
      results?: Array<{ latitude: number; longitude: number; name: string }>;
    };
    if (!data.results || data.results.length === 0) {
      log.warn({ city }, 'geocoding returned no results');
      return null;
    }
    const r = data.results[0]!;
    return { latitude: r.latitude, longitude: r.longitude, city: r.name };
  } catch (err) {
    log.error({ err, city }, 'geocoding error');
    return null;
  }
}

/**
 * Fetch multi-model temperature forecasts from Open-Meteo.
 * Returns per-model max temperature for the target date.
 */
export async function fetchMultiModelForecast(
  latitude: number,
  longitude: number,
  targetDate: Date,
  metric: WeatherMetric,
): Promise<ModelForecast[]> {
  const dailyParam =
    metric === 'highest_temp'
      ? 'temperature_2m_max'
      : 'temperature_2m_min';

  const targetDateStr = targetDate.toISOString().slice(0, 10);
  const modelsParam = WEATHER_MODELS.join(',');

  // Open-Meteo supports fetching multiple models in a single request via the
  // `models` parameter when using the multi-model endpoint.
  const url = `${OPEN_METEO_FORECAST_URL}?latitude=${latitude}&longitude=${longitude}&daily=${dailyParam}&models=${modelsParam}&forecast_days=7&timezone=auto`;

  const results: ModelForecast[] = [];

  try {
    const res = await fetch(url);
    if (!res.ok) {
      log.warn({ status: res.status, url }, 'Open-Meteo forecast request failed');
      return [];
    }

    const data = (await res.json()) as {
      daily?: {
        time: string[];
        [key: string]: string[] | number[] | null[];
      };
    };

    // Open-Meteo multi-model returns a SINGLE "daily" object with per-model
    // columns named like "temperature_2m_max_gfs_seamless",
    // "temperature_2m_max_ecmwf_ifs04", etc. Not separate top-level keys.
    const daily = data?.daily;
    if (daily && Array.isArray(daily.time)) {
      const dateIndex = daily.time.indexOf(targetDateStr);
      if (dateIndex !== -1) {
        for (const model of WEATHER_MODELS) {
          const colKey = `${dailyParam}_${model}`;
          const values = daily[colKey] as number[] | null[] | undefined;
          if (!values) continue;
          const val = values[dateIndex];
          if (val != null && typeof val === 'number') {
            results.push({ modelName: model, value: val });
          }
        }
      }
    }
  } catch (err) {
    log.error({ err, url }, 'Open-Meteo forecast error');
  }

  // Fallback: if the multi-model request didn't return enough model data
  // (some models don't support all regions), try fetching each model
  // individually. The response format is the same: a single "daily" object
  // with per-model columns.
  const seenModels = new Set(results.map((r) => r.modelName));
  if (seenModels.size < 3) {
    for (const model of WEATHER_MODELS) {
      if (seenModels.has(model)) continue;
      const singleUrl = `${OPEN_METEO_FORECAST_URL}?latitude=${latitude}&longitude=${longitude}&daily=${dailyParam}&models=${model}&forecast_days=7&timezone=auto`;
      try {
        const res = await fetch(singleUrl);
        if (!res.ok) continue;
        const data = (await res.json()) as {
          daily?: { time: string[]; [key: string]: unknown };
        };
        const daily = data?.daily;
        if (!daily || !Array.isArray(daily.time)) continue;
        const dateIndex = daily.time.indexOf(targetDateStr);
        if (dateIndex === -1) continue;
        const colKey = `${dailyParam}_${model}`;
        const values = daily[colKey] as number[] | null[] | undefined;
        if (!values) continue;
        const val = values[dateIndex];
        if (val != null && typeof val === 'number') {
          results.push({ modelName: model, value: val });
        }
      } catch {
        continue;
      }
    }
  }

  return results;
}

/**
 * Aggregate per-model forecasts into a mean + std dev.
 */
export function buildForecastFromModelResults(
  modelForecasts: number[],
): ForecastAggregation {
  const n = modelForecasts.length;
  if (n === 0) {
    return { forecastMean: 0, forecastStdDev: 0, modelValues: {} };
  }
  const mean = modelForecasts.reduce((a, b) => a + b, 0) / n;
  if (n === 1) {
    return { forecastMean: mean, forecastStdDev: 0, modelValues: {} };
  }
  const variance =
    modelForecasts.reduce((acc, v) => acc + (v - mean) ** 2, 0) / (n - 1);
  const stdDev = Math.sqrt(variance);
  return {
    forecastMean: mean,
    forecastStdDev: stdDev,
    modelValues: {},
  };
}

/**
 * Full end-to-end forecast: geocode city, fetch multi-model forecasts,
 * aggregate into mean + std dev.
 */
export async function fetchWeatherForecast(
  city: string,
  targetDate: Date,
  metric: WeatherMetric,
): Promise<{
  forecastMean: number;
  forecastStdDev: number;
  modelValues: Record<string, number>;
  latitude: number;
  longitude: number;
} | null> {
  const geo = await geocodeCity(city);
  if (!geo) return null;

  const models = await fetchMultiModelForecast(
    geo.latitude,
    geo.longitude,
    targetDate,
    metric,
  );
  if (models.length === 0) return null;

  const modelValues: Record<string, number> = {};
  for (const m of models) {
    modelValues[m.modelName] = m.value;
  }

  const agg = buildForecastFromModelResults(models.map((m) => m.value));
  return {
    ...agg,
    modelValues,
    latitude: geo.latitude,
    longitude: geo.longitude,
  };
}