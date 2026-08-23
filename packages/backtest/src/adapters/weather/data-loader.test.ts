import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DataSource } from 'typeorm';
import {
  createTestDataSource,
  initializeDataSource,
  WeatherBucketTick,
  WeatherMarketSnapshot,
  WeatherForecastHistory,
  WeatherEvaluationLog,
} from '@polywatch/core';
import { loadWeatherEvents, countWeatherEvents } from './data-loader.js';
import type { BacktestRunParams } from '../../params.js';

function params(overrides: Partial<BacktestRunParams> = {}): BacktestRunParams {
  return {
    domain: 'weather',
    mode: 'replay',
    from: '2026-01-01T00:00:00.000Z',
    to: '2026-01-02T00:00:00.000Z',
    strategyId: 'weather-forecast',
    backtestExecutionMode: 'runner-sim',
    capital: 1000,
    entryUsdc: 10,
    slippageBps: 50,
    maxConcurrentPositions: 10,
    ...overrides,
  } as BacktestRunParams;
}

describe('data-loader pagination & filters', () => {
  let ds: DataSource;

  beforeEach(async () => {
    ds = await initializeDataSource(createTestDataSource());
  });

  afterEach(async () => {
    await ds.destroy();
  });

  it('yields tick events in (recordedAt, id) order', async () => {
    const snapRepo = ds.getRepository(WeatherMarketSnapshot);
    const tickRepo = ds.getRepository(WeatherBucketTick);
    const snap = await snapRepo.save(
      snapRepo.create({
        city: 'london', cityNormalized: 'london', targetDateIso: '2026-01-01',
        metric: 'highest_temp', forecastMean: 12, forecastStdDev: 1.5,
        bucketCount: 1, totalBucketCount: 3, recordedAt: new Date('2026-01-01T00:00:00Z'),
      }),
    );
    for (let i = 0; i < 3; i++) {
      await tickRepo.save(
        tickRepo.create({
          snapshotId: snap.id, conditionId: `c${i}`, eventSlug: 'e',
          question: 'q', bucketComparison: 'or_above', bucketTarget: 12,
          bucketLow: null, bucketHigh: null, yesPrice: 0.5, noPrice: 0.5,
          yesTokenId: 'y', noTokenId: 'n', volume: 1, volume24hr: 1, liquidityClob: 1,
          acceptingOrders: true, closed: false, endDate: null,
          recordedAt: new Date(`2026-01-01T00:0${i}:00.000Z`),
          city: 'london', cityNormalized: 'london', targetDateIso: '2026-01-01', metric: 'highest_temp',
        }),
      );
    }
    const events = [];
    for await (const e of loadWeatherEvents(ds, params())) {
      events.push(e);
    }
    const tickEvents = events.filter((e) => e.kind === 'book_tick');
    expect(tickEvents.length).toBe(3);
    const times = tickEvents.map((e) => e.at.getTime());
    for (let i = 1; i < times.length; i++) {
      expect(times[i]!).toBeGreaterThanOrEqual(times[i - 1]!);
    }
  });

  it('applies the city filter', async () => {
    const snapRepo = ds.getRepository(WeatherMarketSnapshot);
    const tickRepo = ds.getRepository(WeatherBucketTick);
    for (const city of ['london', 'paris']) {
      const snap = await snapRepo.save(
        snapRepo.create({
          city, cityNormalized: city, targetDateIso: '2026-01-01',
          metric: 'highest_temp', forecastMean: 12, forecastStdDev: 1.5,
          bucketCount: 1, totalBucketCount: 3, recordedAt: new Date('2026-01-01T00:00:00Z'),
        }),
      );
      await tickRepo.save(
        tickRepo.create({
          snapshotId: snap.id, conditionId: `c-${city}`, eventSlug: 'e',
          question: 'q', bucketComparison: 'or_above', bucketTarget: 12,
          bucketLow: null, bucketHigh: null, yesPrice: 0.5, noPrice: 0.5,
          yesTokenId: 'y', noTokenId: 'n', volume: 1, volume24hr: 1, liquidityClob: 1,
          acceptingOrders: true, closed: false, endDate: null,
          recordedAt: new Date('2026-01-01T00:00:00Z'),
          city, cityNormalized: city, targetDateIso: '2026-01-01', metric: 'highest_temp',
        }),
      );
    }
    const events = [];
    for await (const e of loadWeatherEvents(ds, params({ cities: ['paris'] }))) events.push(e);
    const ticks = events.filter((e) => e.kind === 'book_tick');
    expect(ticks.length).toBe(1);
    expect((ticks[0]!.data as { snapshotCity: string }).snapshotCity).toBe('paris');
  });

  it('counts events for the requested range and city', async () => {
    const snapRepo = ds.getRepository(WeatherMarketSnapshot);
    const tickRepo = ds.getRepository(WeatherBucketTick);
    const evalRepo = ds.getRepository(WeatherEvaluationLog);
    const histRepo = ds.getRepository(WeatherForecastHistory);
    const snap = await snapRepo.save(
      snapRepo.create({
        city: 'london', cityNormalized: 'london', targetDateIso: '2026-01-01',
        metric: 'highest_temp', forecastMean: 12, forecastStdDev: 1.5,
        bucketCount: 1, totalBucketCount: 3, recordedAt: new Date('2026-01-01T00:00:00Z'),
      }),
    );
    await tickRepo.save(
      tickRepo.create({
        snapshotId: snap.id, conditionId: 'c1', eventSlug: 'e', question: 'q',
        bucketComparison: 'or_above', bucketTarget: 12, bucketLow: null, bucketHigh: null,
        yesPrice: 0.5, noPrice: 0.5, yesTokenId: 'y', noTokenId: 'n',
        volume: 1, volume24hr: 1, liquidityClob: 1,
        acceptingOrders: true, closed: false, endDate: null,
        recordedAt: new Date('2026-01-01T00:00:00Z'),
        city: 'london', cityNormalized: 'london', targetDateIso: '2026-01-01', metric: 'highest_temp',
      }),
    );
    await evalRepo.save(
      evalRepo.create({
        snapshotId: snap.id, conditionId: 'c1', bucketComparison: 'or_above',
        bucketTarget: 12, bucketLow: null, bucketHigh: null,
        strategyId: 'weather-forecast', yesPrice: 0.5, forecastProb: 0.7,
        edge: 0.2, dynamicMinEdge: 0.1, decision: 'signal', reason: 'test',
        evaluatedAt: new Date('2026-01-01T00:00:00Z'),
      }),
    );
    await histRepo.save(
      histRepo.create({
        city: 'london', forecastDate: new Date('2026-01-01T12:00:00Z'),
        metric: 'highest_temp', forecastMean: 12, forecastStdDev: 1.5,
        modelValuesJson: '{}', latitude: 51.5, longitude: -0.1,
        fetchedAt: new Date('2026-01-01T00:00:00Z'),
      }),
    );
    const total = await countWeatherEvents(ds, params({ mode: 'replay' }));
    // 1 tick + 1 signal (replay) + 1 forecast.
    expect(total).toBe(3);
  });
});
