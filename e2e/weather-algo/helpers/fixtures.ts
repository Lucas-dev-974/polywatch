import type { DataSource } from 'typeorm';
import { Market } from '@polywatch/core';
import type { WeatherSignal } from '../../packages/weather-algo/src/strategy/strategy.js';

export interface WeatherMarketFixture {
  conditionId: string;
  tokenIdYes: string;
  tokenIdNo: string;
}

export async function seedWeatherMarketFixture(ds: DataSource): Promise<WeatherMarketFixture> {
  const conditionId = '0xweather_e2e_paris_33c_01';
  const tokenIdYes = '0xYES_weather_e2e_paris_33c_01';
  const tokenIdNo = '0xNO_weather_e2e_paris_33c_01';
  const futureDate = new Date(Date.now() + 48 * 60 * 60 * 1000);

  const marketRepo = ds.getRepository(Market);
  await marketRepo.save(marketRepo.create({
    conditionId,
    question: 'Will the highest temperature in Paris be 33°C on August 2?',
    slug: 'paris-highest-temp-aug2-e2e',
    eventSlug: 'paris-weather-aug2',
    endDate: futureDate,
    acceptingOrders: true,
    closed: false,
    resolved: false,
    tokenIdYes,
    tokenIdNo,
    active: true,
    icon: null,
    category: 'Weather',
    tagSlugs: JSON.stringify(['weather']),
  }));

  return { conditionId, tokenIdYes, tokenIdNo };
}

export function makeWeatherSignal(
  fixture: WeatherMarketFixture,
  overrides?: Partial<WeatherSignal>,
): WeatherSignal {
  return {
    conditionId: fixture.conditionId,
    assetId: fixture.tokenIdYes,
    outcome: 'YES',
    side: 'BUY',
    confidence: 0.2,
    reasons: ['weather-algo e2e test'],
    strategyId: 'weather-forecast',
    eventSlug: 'paris-weather-aug2',
    city: 'Paris',
    metric: 'highest_temp',
    targetDate: new Date(Date.now() + 48 * 60 * 60 * 1000),
    forecastMean: 32,
    forecastStdDev: 1.5,
    forecastProbability: 0.2,
    marketPrice: 0.05,
    edge: 0.15,
    entryBucketComparison: 'exact',
    entryBucketBounds: { target: 33 },
    ...overrides,
  };
}
