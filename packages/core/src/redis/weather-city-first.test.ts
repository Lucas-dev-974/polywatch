import { describe, expect, it, vi } from 'vitest';
import {
  weatherReentryThrottleKey,
  weatherReentryThrottleLegacyKey,
  setWeatherReentryThrottle,
  hasWeatherReentryThrottle,
} from '../redis/weather-reentry-throttle.js';
import {
  weatherReentryCountKey,
  weatherReentryCountLegacyKey,
  getWeatherReentryCount,
  incrementWeatherReentryCount,
} from '../redis/weather-reentry-count.js';
import {
  weatherBucketHysteresisKey,
  incrementWeatherBucketHysteresis,
  resetWeatherBucketHysteresis,
  getWeatherBucketHysteresis,
} from '../redis/weather-bucket-hysteresis.js';

describe('weather-reentry-throttle', () => {
  it('builds normalized key', () => {
    expect(weatherReentryThrottleKey(' Paris ', '2026-08-15', 'sim')).toBe('weather-reentry:paris:2026-08-15:sim');
  });

  it('set/has round-trip', async () => {
    const store = new Map<string, string>();
    const redis = {
      set: vi.fn(async (key: string, value: string) => {
        store.set(key, value);
        return 'OK';
      }),
      exists: vi.fn(async (key: string) => (store.has(key) ? 1 : 0)),
    };
    await setWeatherReentryThrottle(redis, 'Paris', '2026-08-15', 'sim', 60_000);
    expect(await hasWeatherReentryThrottle(redis, 'Paris', '2026-08-15', 'sim')).toBe(true);
    expect(await hasWeatherReentryThrottle(redis, 'Lyon', '2026-08-15', 'sim')).toBe(false);
    // A different date for the same city is a distinct throttle bucket.
    expect(await hasWeatherReentryThrottle(redis, 'Paris', '2026-08-16', 'sim')).toBe(false);
  });

  it('honours legacy throttle keys without mode suffix', async () => {
    const store = new Map<string, string>();
    const redis = {
      set: vi.fn(async (key: string, value: string) => {
        store.set(key, value);
        return 'OK';
      }),
      exists: vi.fn(async (key: string) => (store.has(key) ? 1 : 0)),
    };
    store.set(weatherReentryThrottleLegacyKey('Paris', '2026-08-15'), '1');
    expect(await hasWeatherReentryThrottle(redis, 'Paris', '2026-08-15', 'sim')).toBe(true);
    expect(await hasWeatherReentryThrottle(redis, 'Paris', '2026-08-15', 'real')).toBe(true);
  });
});

describe('weather-reentry-count', () => {
  it('reads legacy entry-count keys without mode suffix', async () => {
    const store = new Map<string, string>();
    const redis = {
      get: vi.fn(async (key: string) => store.get(key) ?? null),
      set: vi.fn(async (key: string, value: string) => {
        store.set(key, value);
        return 'OK';
      }),
      incr: vi.fn(async (key: string) => {
        const next = Number(store.get(key) ?? 0) + 1;
        store.set(key, String(next));
        return next;
      }),
    };
    store.set(weatherReentryCountLegacyKey('Paris', '2026-08-15', 'weather-forecast'), '2');
    expect(
      await getWeatherReentryCount(redis, 'Paris', '2026-08-15', 'weather-forecast', 'sim'),
    ).toBe(2);
    expect(
      await incrementWeatherReentryCount(
        redis,
        'Paris',
        '2026-08-15',
        'weather-forecast',
        'sim',
      ),
    ).toBe(3);
    expect(store.get(weatherReentryCountKey('Paris', '2026-08-15', 'weather-forecast', 'sim'))).toBe(
      '3',
    );
  });
});

describe('weather-bucket-hysteresis', () => {
  it('increments and resets', async () => {
    const store = new Map<string, string>();
    const redis = {
      incr: vi.fn(async (key: string) => {
        const next = Number(store.get(key) ?? 0) + 1;
        store.set(key, String(next));
        return next;
      }),
      expire: vi.fn(async () => 1),
      del: vi.fn(async (key: string) => {
        store.delete(key);
        return 1;
      }),
      get: vi.fn(async (key: string) => store.get(key) ?? null),
    };

    expect(weatherBucketHysteresisKey(42)).toBe('weather-bucket-hysteresis:42');
    expect(await incrementWeatherBucketHysteresis(redis, 42)).toBe(1);
    expect(await incrementWeatherBucketHysteresis(redis, 42)).toBe(2);
    expect(await getWeatherBucketHysteresis(redis, 42)).toBe(2);
    await resetWeatherBucketHysteresis(redis, 42);
    expect(await getWeatherBucketHysteresis(redis, 42)).toBe(0);
  });
});
