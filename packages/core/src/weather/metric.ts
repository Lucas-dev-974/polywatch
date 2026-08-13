export const WEATHER_METRICS = ['highest_temp', 'lowest_temp'] as const;
export type WeatherMetric = (typeof WEATHER_METRICS)[number];

export function isWeatherMetric(value: unknown): value is WeatherMetric {
  return (
    typeof value === 'string' &&
    (WEATHER_METRICS as readonly string[]).includes(value)
  );
}
