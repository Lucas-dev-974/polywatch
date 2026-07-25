import { describe, it, expect } from 'vitest';
import { buildForecastFromModelResults } from './weather-api-client.js';

describe('buildForecastFromModelResults', () => {
  it('computes mean and std dev from model values', () => {
    const result = buildForecastFromModelResults([31, 30, 32, 31, 30]);
    expect(result.forecastMean).toBeCloseTo(30.8, 1);
    // Sample std dev (n-1 denominator) = sqrt(variance) where variance = sum((x-mean)^2)/(n-1)
    expect(result.forecastStdDev).toBeCloseTo(0.837, 2);
  });

  it('returns 0 std dev when all models agree', () => {
    const result = buildForecastFromModelResults([31, 31, 31]);
    expect(result.forecastMean).toBe(31);
    expect(result.forecastStdDev).toBe(0);
  });

  it('handles single model', () => {
    const result = buildForecastFromModelResults([31]);
    expect(result.forecastMean).toBe(31);
    expect(result.forecastStdDev).toBe(0);
  });
});