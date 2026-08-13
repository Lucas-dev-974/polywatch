import { describe, it, expect } from 'vitest';
import { WEATHER_METRICS, isWeatherMetric } from './metric.js';

describe('WEATHER_METRICS', () => {
  it('contains exactly the two supported metrics in stable order', () => {
    expect(WEATHER_METRICS).toEqual(['highest_temp', 'lowest_temp']);
  });
});

describe('isWeatherMetric', () => {
  it('accepts the two supported metrics', () => {
    expect(isWeatherMetric('highest_temp')).toBe(true);
    expect(isWeatherMetric('lowest_temp')).toBe(true);
  });

  it('rejects unsupported values', () => {
    expect(isWeatherMetric('temp')).toBe(false);
    expect(isWeatherMetric('precip')).toBe(false);
    expect(isWeatherMetric('wind')).toBe(false);
    expect(isWeatherMetric('')).toBe(false);
    expect(isWeatherMetric(null)).toBe(false);
    expect(isWeatherMetric(undefined)).toBe(false);
    expect(isWeatherMetric(42)).toBe(false);
  });
});
