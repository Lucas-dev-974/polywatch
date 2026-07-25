import { describe, it, expect, vi } from 'vitest';
import { enrichCityGroupsWithForecast } from './weather-forecast-enricher.js';
import type { CityMarketGroup } from './weather-market-discovery.js';

// Mock fetchWeatherForecast at the source module level
vi.mock('./weather-api-client.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./weather-api-client.js')>();
  return {
    ...mod,
    fetchWeatherForecast: vi.fn(),
  };
});

// Import the mocked function for assertion
import { fetchWeatherForecast } from './weather-api-client.js';

function makeGroup(city: string, question: string): CityMarketGroup {
  return {
    city,
    markets: [{
      conditionId: 'c1',
      question,
      eventSlug: null,
      slug: null,
      icon: null,
      endDate: null,
      startDate: null,
      volume: null,
      volume24hr: null,
      liquidityClob: null,
      outcomePrices: [],
      outcomes: [],
      acceptingOrders: null,
      closed: false,
      url: '',
      tokenIdYes: null,
      tokenIdNo: null,
      category: null,
      tagSlugs: [],
      cryptoSymbol: null,
      interval: null,
      cryptoCategory: null,
      marketType: 'standard' as any,
    }],
  };
}

/** Mock DataSource with a repository that returns cached forecast or null. */
function makeMockDs(cachedRow: any | null): any {
  const repo = {
    findOne: vi.fn().mockResolvedValue(cachedRow),
    save: vi.fn().mockResolvedValue(undefined),
  };
  return { getRepository: () => repo } as any;
}

describe('enrichCityGroupsWithForecast', () => {
  it('uses fresh cache and skips external call', async () => {
    const ds = makeMockDs({
      city: 'Hong Kong',
      forecastDate: new Date('2026-07-25'),
      metric: 'highest_temp',
      forecastMean: 31.5,
      forecastStdDev: 0.8,
      modelValues: '{}',
      latitude: 22.3,
      longitude: 114.1,
      fetchedAt: new Date(),
      expiresAt: new Date(Date.now() + 3600_000), // fresh
    });

    const groups = [makeGroup('Hong Kong', 'Will the highest temperature in Hong Kong be 31°C on July 25?')];
    const result = await enrichCityGroupsWithForecast(ds, groups);
    expect(result).toHaveLength(1);
    expect(result[0].forecastMean).toBe(31.5);
    expect(result[0].forecastStatus).toBe('fresh');
    expect(fetchWeatherForecast).not.toHaveBeenCalled();
  });

  it('fetches externally on cache miss', async () => {
    const ds = makeMockDs(null);
    vi.mocked(fetchWeatherForecast).mockResolvedValue({
      forecastMean: 29.2,
      forecastStdDev: 1.1,
      modelValues: { gfs: 29 },
      latitude: 22.3,
      longitude: 114.1,
    });

    const groups = [makeGroup('Hong Kong', 'Will the highest temperature in Hong Kong be 31°C on July 25?')];
    const result = await enrichCityGroupsWithForecast(ds, groups);
    expect(result[0].forecastMean).toBe(29.2);
    expect(result[0].forecastStatus).toBe('fresh');
  });

  it('marks forecast unavailable when external fetch fails and no cache', async () => {
    const ds = makeMockDs(null);
    vi.mocked(fetchWeatherForecast).mockResolvedValue(null);

    const groups = [makeGroup('UnknownCity', 'Will the highest temperature in UnknownCity be 20°C on July 25?')];
    const result = await enrichCityGroupsWithForecast(ds, groups);
    expect(result[0].forecastMean).toBeNull();
    expect(result[0].forecastStatus).toBe('unavailable');
  });

  it('returns stale cache when external fetch fails', async () => {
    const ds = makeMockDs({
      city: 'Hong Kong',
      forecastDate: new Date('2026-07-25'),
      metric: 'highest_temp',
      forecastMean: 30.0,
      forecastStdDev: 1.0,
      modelValues: '{}',
      latitude: 22.3,
      longitude: 114.1,
      fetchedAt: new Date(Date.now() - 7200_000), // 2h ago
      expiresAt: new Date(Date.now() - 3600_000), // expired → stale
    });
    vi.mocked(fetchWeatherForecast).mockResolvedValue(null);

    const groups = [makeGroup('Hong Kong', 'Will the highest temperature in Hong Kong be 31°C on July 25?')];
    const result = await enrichCityGroupsWithForecast(ds, groups);
    expect(result[0].forecastMean).toBe(30.0);
    expect(result[0].forecastStatus).toBe('stale');
  });
});
