import { describe, expect, it } from 'vitest';
import {
  WeatherPositionForecastService,
  type WeatherPositionForecastInput,
} from './weather-position-forecast.service.js';

const INPUT: WeatherPositionForecastInput = {
  copiedPositionId: 42,
  city: 'Paris',
  targetDate: new Date('2026-07-26T12:00:00Z'),
  metric: 'highest_temp',
  entryForecastMean: 28,
  entryForecastStdDev: 1.2,
  entryModelValues: { gfs: 28 },
};

function makeDs(rawRef: { current: unknown[] }) {
  return {
    getRepository: () => ({
      createQueryBuilder: () => ({
        insert: () => ({
          into: () => ({
            values: () => ({
              onConflict: () => ({
                execute: async () => ({ raw: rawRef.current }),
              }),
            }),
          }),
        }),
      }),
    }),
  } as never;
}

describe('WeatherPositionForecastService.saveIfAbsent', () => {
  it('is idempotent per copiedPositionId', async () => {
    const rawRef = { current: [{ id: 1 }] };
    const service = new WeatherPositionForecastService(makeDs(rawRef));

    expect(await service.saveIfAbsent(INPUT)).toBe(true);
    rawRef.current = [];
    expect(await service.saveIfAbsent(INPUT)).toBe(false);
  });

  it('returns true when a row is inserted', async () => {
    const service = new WeatherPositionForecastService(makeDs({ current: [{ id: 1 }] }));
    expect(await service.saveIfAbsent(INPUT)).toBe(true);
  });

  it('returns false when the insert conflicts (DO NOTHING)', async () => {
    const service = new WeatherPositionForecastService(makeDs({ current: [] }));
    expect(await service.saveIfAbsent(INPUT)).toBe(false);
  });
});
