import { describe, expect, it } from 'vitest';
import {
  WeatherPositionForecastService,
  type WeatherPositionForecastInput,
} from './weather-position-forecast.service.js';

describe('WeatherPositionForecastService.saveIfAbsent', () => {
  it('is idempotent per copiedPositionId', async () => {
    const saved: WeatherPositionForecastInput[] = [];
    const ds = {
      getRepository: () => ({
        findOne: async ({ where }: { where: { copiedPositionId: number } }) =>
          saved.find((s) => s.copiedPositionId === where.copiedPositionId) ?? null,
        save: async (row: WeatherPositionForecastInput) => {
          saved.push(row);
          return row;
        },
      }),
    } as never;

    const service = new WeatherPositionForecastService(ds);
    const input: WeatherPositionForecastInput = {
      copiedPositionId: 42,
      city: 'Paris',
      targetDate: new Date('2026-07-26T12:00:00Z'),
      metric: 'highest_temp',
      entryForecastMean: 28,
      entryForecastStdDev: 1.2,
      entryModelValues: { gfs: 28 },
    };

    expect(await service.saveIfAbsent(input)).toBe(true);
    expect(await service.saveIfAbsent(input)).toBe(false);
    expect(saved).toHaveLength(1);
  });
});
