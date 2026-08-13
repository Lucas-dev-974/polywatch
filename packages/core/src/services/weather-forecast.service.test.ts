import { describe, expect, it } from 'vitest';
import { WeatherForecastService } from './weather-forecast.service.js';
import type { WeatherForecastCache } from '../entities/WeatherForecastCache.js';

function makeRow(overrides: Partial<WeatherForecastCache> = {}): Partial<WeatherForecastCache> {
  return {
    id: 1,
    city: 'paris',
    forecastDate: new Date('2026-07-26T00:00:00Z'),
    metric: 'highest_temp',
    forecastMean: 28,
    forecastStdDev: 1.2,
    modelValues: '{"gfs":28,"ecmwf":27}',
    latitude: 48.85,
    longitude: 2.35,
    fetchedAt: new Date('2026-07-26T09:00:00Z'),
    expiresAt: new Date('2099-01-01T00:00:00Z'),
    ...overrides,
  } as unknown as Partial<WeatherForecastCache>;
}

describe('WeatherForecastService.getCached', () => {
  it('parses valid modelValues JSON', async () => {
    let captured: unknown = null;
    const ds = {
      getRepository: () => ({
        findOne: async () => {
          captured = makeRow();
          return captured;
        },
      }),
    } as never;
    const service = new WeatherForecastService(ds);
    const result = await service.getCached(
      'paris',
      new Date('2026-07-26T00:00:00Z'),
      'highest_temp',
    );
    expect(result).not.toBeNull();
    expect(result?.modelValues).toEqual({ gfs: 28, ecmwf: 27 });
  });

  it('returns null when modelValues JSON is corrupted', async () => {
    const ds = {
      getRepository: () => ({
        findOne: async () => makeRow({ modelValues: '{invalid' }),
      }),
    } as never;
    const service = new WeatherForecastService(ds);
    const result = await service.getCached(
      'paris',
      new Date('2026-07-26T00:00:00Z'),
      'highest_temp',
    );
    expect(result).toBeNull();
  });
});
