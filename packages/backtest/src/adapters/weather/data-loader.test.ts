import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DataSource } from 'typeorm';
import {
  createTestDataSource,
  initializeDataSource,
  WeatherBucketTick,
  WeatherMarketSnapshot,
  WeatherForecastHistory,
} from '@polywatch/core';
import { loadWeatherEvents, countWeatherEvents, computeWeatherFidelityStats } from './data-loader.js';
import type { BacktestRunParams } from '../../params.js';

function params(overrides: Partial<BacktestRunParams> = {}): BacktestRunParams {
  return {
    domain: 'weather',
    mode: 'reevaluate',
    from: '2026-01-01T00:00:00.000Z',
    to: '2026-01-02T00:00:00.000Z',
    strategyId: 'weather-forecast',
    capital: 1000,
    entryPusd: 10,
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
    await histRepo.save(
      histRepo.create({
        city: 'london', forecastDate: new Date('2026-01-01T12:00:00Z'),
        metric: 'highest_temp', forecastMean: 12, forecastStdDev: 1.5,
        modelValuesJson: '{}', latitude: 51.5, longitude: -0.1,
        fetchedAt: new Date('2026-01-01T00:00:00Z'),
      }),
    );
    const total = await countWeatherEvents(ds, params());
    // 1 tick + 1 forecast (le signal replay n'existe plus).
    expect(total).toBe(2);
  });
});

describe('computeWeatherFidelityStats (§12.2)', () => {
  let ds: DataSource;

  beforeEach(async () => {
    ds = await initializeDataSource(createTestDataSource());
  });

  afterEach(async () => {
    await ds.destroy();
  });

  it('computes inactive buckets, price nulls, snapshots and revisions', async () => {
    const snapRepo = ds.getRepository(WeatherMarketSnapshot);
    const tickRepo = ds.getRepository(WeatherBucketTick);
    const histRepo = ds.getRepository(WeatherForecastHistory);

    // Snapshot 1 : 1 bucket actif sur 3 (2 exclus) — arbitrage incomplet.
    const snap1 = await snapRepo.save(
      snapRepo.create({
        city: 'london', cityNormalized: 'london', targetDateIso: '2026-01-01',
        metric: 'highest_temp', forecastMean: 12, forecastStdDev: 1.5,
        bucketCount: 1, totalBucketCount: 3, recordedAt: new Date('2026-01-01T00:00:00Z'),
      }),
    );
    // Snapshot 2 : complet (1 actif sur 1).
    const snap2 = await snapRepo.save(
      snapRepo.create({
        city: 'paris', cityNormalized: 'paris', targetDateIso: '2026-01-01',
        metric: 'highest_temp', forecastMean: 20, forecastStdDev: 1,
        bucketCount: 1, totalBucketCount: 1, recordedAt: new Date('2026-01-01T12:00:00Z'),
      }),
    );
    // Tick avec yesPrice null (snap1) et tick complet (snap2).
    await tickRepo.save(
      tickRepo.create({
        snapshotId: snap1.id, conditionId: 'c1', eventSlug: 'e', question: 'q',
        bucketComparison: 'or_above', bucketTarget: 12, bucketLow: null, bucketHigh: null,
        yesPrice: null, noPrice: 0.5, yesTokenId: 'y', noTokenId: 'n',
        volume: 1, volume24hr: 1, liquidityClob: 1, acceptingOrders: true, closed: false,
        endDate: null, recordedAt: new Date('2026-01-01T00:00:00Z'),
        city: 'london', cityNormalized: 'london', targetDateIso: '2026-01-01', metric: 'highest_temp',
      }),
    );
    await tickRepo.save(
      tickRepo.create({
        snapshotId: snap2.id, conditionId: 'c2', eventSlug: 'e', question: 'q',
        bucketComparison: 'or_above', bucketTarget: 20, bucketLow: null, bucketHigh: null,
        yesPrice: 0.4, noPrice: null, yesTokenId: 'y', noTokenId: 'n',
        volume: 1, volume24hr: 1, liquidityClob: 1, acceptingOrders: true, closed: false,
        endDate: null, recordedAt: new Date('2026-01-01T12:00:00Z'),
        city: 'paris', cityNormalized: 'paris', targetDateIso: '2026-01-01', metric: 'highest_temp',
      }),
    );
    // 2 révisions forecast (london + paris).
    await histRepo.save(
      histRepo.create({
        city: 'london', forecastDate: new Date('2026-01-01T12:00:00Z'),
        metric: 'highest_temp', forecastMean: 12, forecastStdDev: 1.5,
        modelValuesJson: '{}', latitude: 51.5, longitude: -0.1,
        fetchedAt: new Date('2026-01-01T00:00:00Z'),
      }),
    );
    await histRepo.save(
      histRepo.create({
        city: 'paris', forecastDate: new Date('2026-01-01T12:00:00Z'),
        metric: 'highest_temp', forecastMean: 20, forecastStdDev: 1,
        modelValuesJson: '{}', latitude: 48.8, longitude: 2.3,
        fetchedAt: new Date('2026-01-01T12:00:00Z'),
      }),
    );

    const stats = await computeWeatherFidelityStats(ds, params());
    expect(stats.inactiveBucketsExcluded).toBe(2); // (3-1) + (1-1)
    expect(stats.incompleteCityDates).toBe(1); // snap1 only
    expect(stats.yesPriceNulls).toBe(1);
    expect(stats.noPriceNulls).toBe(1);
    expect(stats.snapshots).toBe(2);
    expect(stats.forecastRevisions).toBe(2);
    expect(stats.snapshotsPerDay).toBe(2); // 2 snapshots / 1 jour
    expect(stats.forecastRevisionsPerDay).toBe(2);
    // london + paris ont chacun un snapshot → pas de missing.
    expect(stats.missingSnapshots).toBe(0);
  });

  it('detects missing snapshots for city/date with forecast but no snapshot', async () => {
    const snapRepo = ds.getRepository(WeatherMarketSnapshot);
    const histRepo = ds.getRepository(WeatherForecastHistory);

    await snapRepo.save(
      snapRepo.create({
        city: 'london', cityNormalized: 'london', targetDateIso: '2026-01-01',
        metric: 'highest_temp', forecastMean: 12, forecastStdDev: 1.5,
        bucketCount: 1, totalBucketCount: 1, recordedAt: new Date('2026-01-01T00:00:00Z'),
      }),
    );
    // Forecast pour paris/2026-01-01 sans snapshot correspondant.
    await histRepo.save(
      histRepo.create({
        city: 'paris', forecastDate: new Date('2026-01-01T12:00:00Z'),
        metric: 'highest_temp', forecastMean: 20, forecastStdDev: 1,
        modelValuesJson: '{}', latitude: 48.8, longitude: 2.3,
        fetchedAt: new Date('2026-01-01T12:00:00Z'),
      }),
    );

    const stats = await computeWeatherFidelityStats(ds, params());
    expect(stats.missingSnapshots).toBe(1);
  });

  it('applies the city filter', async () => {
    const snapRepo = ds.getRepository(WeatherMarketSnapshot);
    const histRepo = ds.getRepository(WeatherForecastHistory);

    await snapRepo.save(
      snapRepo.create({
        city: 'london', cityNormalized: 'london', targetDateIso: '2026-01-01',
        metric: 'highest_temp', forecastMean: 12, forecastStdDev: 1.5,
        bucketCount: 1, totalBucketCount: 3, recordedAt: new Date('2026-01-01T00:00:00Z'),
      }),
    );
    await histRepo.save(
      histRepo.create({
        city: 'paris', forecastDate: new Date('2026-01-01T12:00:00Z'),
        metric: 'highest_temp', forecastMean: 20, forecastStdDev: 1,
        modelValuesJson: '{}', latitude: 48.8, longitude: 2.3,
        fetchedAt: new Date('2026-01-01T12:00:00Z'),
      }),
    );

    const stats = await computeWeatherFidelityStats(ds, params({ cities: ['london'] }));
    expect(stats.snapshots).toBe(1);
    expect(stats.forecastRevisions).toBe(0); // paris filtré
    expect(stats.inactiveBucketsExcluded).toBe(2);
  });
});

describe('computeWeatherFidelityStats (§12.2)', () => {
  let ds: DataSource;

  beforeEach(async () => {
    ds = await initializeDataSource(createTestDataSource());
  });

  afterEach(async () => {
    await ds.destroy();
  });

  async function seedSnapshot(
    snapRepo: ReturnType<DataSource['getRepository']>,
    tickRepo: ReturnType<DataSource['getRepository']>,
    opts: {
      city: string;
      recordedAt: string;
      bucketCount: number;
      totalBucketCount: number;
      yesPrice: number | null;
      noPrice: number | null;
    },
  ) {
    const snap = await snapRepo.save(
      snapRepo.create({
        city: opts.city, cityNormalized: opts.city, targetDateIso: '2026-01-01',
        metric: 'highest_temp', forecastMean: 12, forecastStdDev: 1.5,
        bucketCount: opts.bucketCount, totalBucketCount: opts.totalBucketCount,
        recordedAt: new Date(opts.recordedAt),
      }),
    );
    await tickRepo.save(
      tickRepo.create({
        snapshotId: snap.id, conditionId: `c-${opts.city}`, eventSlug: 'e',
        question: 'q', bucketComparison: 'or_above', bucketTarget: 12,
        bucketLow: null, bucketHigh: null, yesPrice: opts.yesPrice, noPrice: opts.noPrice,
        yesTokenId: 'y', noTokenId: 'n', volume: 1, volume24hr: 1, liquidityClob: 1,
        acceptingOrders: true, closed: false, endDate: null,
        recordedAt: new Date(opts.recordedAt),
        city: opts.city, cityNormalized: opts.city, targetDateIso: '2026-01-01', metric: 'highest_temp',
      }),
    );
    return snap;
  }

  it('computes inactiveBucketsExcluded, price nulls and per-day rates', async () => {
    const snapRepo = ds.getRepository(WeatherMarketSnapshot);
    const tickRepo = ds.getRepository(WeatherBucketTick);
    const histRepo = ds.getRepository(WeatherForecastHistory);

    // 2 snapshots : 1 avec 2 buckets exclus (total 3, bucket 1), 1 complet.
    await seedSnapshot(snapRepo, tickRepo, {
      city: 'london', recordedAt: '2026-01-01T00:00:00Z',
      bucketCount: 1, totalBucketCount: 3, yesPrice: 0.5, noPrice: null,
    });
    await seedSnapshot(snapRepo, tickRepo, {
      city: 'paris', recordedAt: '2026-01-01T00:30:00Z',
      bucketCount: 2, totalBucketCount: 2, yesPrice: null, noPrice: 0.4,
    });

    // 2 révisions forecast le même jour.
    for (const at of ['2026-01-01T00:00:00Z', '2026-01-01T06:00:00Z']) {
      await histRepo.save(
        histRepo.create({
          city: 'london', forecastDate: new Date('2026-01-01T12:00:00Z'),
          metric: 'highest_temp', forecastMean: 12, forecastStdDev: 1.5,
          modelValuesJson: '{}', latitude: 51.5, longitude: -0.1,
          fetchedAt: new Date(at),
        }),
      );
    }

    const stats = await computeWeatherFidelityStats(ds, params());
    expect(stats.inactiveBucketsExcluded).toBe(2); // (3-1) + (2-2)
    expect(stats.incompleteCityDates).toBe(1); // london only
    expect(stats.yesPriceNulls).toBe(1); // paris tick
    expect(stats.noPriceNulls).toBe(1); // london tick
    expect(stats.snapshots).toBe(2);
    expect(stats.snapshotsPerDay).toBe(2);
    expect(stats.forecastRevisions).toBe(2);
    expect(stats.forecastRevisionsPerDay).toBe(2);
    expect(stats.missingSnapshots).toBe(0); // london has both snapshot + forecast
  });

  it('detects missingSnapshots for city/date with forecast but no snapshot', async () => {
    const snapRepo = ds.getRepository(WeatherMarketSnapshot);
    const tickRepo = ds.getRepository(WeatherBucketTick);
    const histRepo = ds.getRepository(WeatherForecastHistory);

    // Snapshot pour london seulement.
    await seedSnapshot(snapRepo, tickRepo, {
      city: 'london', recordedAt: '2026-01-01T00:00:00Z',
      bucketCount: 1, totalBucketCount: 1, yesPrice: 0.5, noPrice: 0.5,
    });

    // Forecast pour paris (pas de snapshot) → gap.
    await histRepo.save(
      histRepo.create({
        city: 'paris', forecastDate: new Date('2026-01-01T12:00:00Z'),
        metric: 'highest_temp', forecastMean: 20, forecastStdDev: 1,
        modelValuesJson: '{}', latitude: 48.8, longitude: 2.3,
        fetchedAt: new Date('2026-01-01T00:00:00Z'),
      }),
    );

    const stats = await computeWeatherFidelityStats(ds, params());
    expect(stats.missingSnapshots).toBe(1);
  });

  it('respects the city filter', async () => {
    const snapRepo = ds.getRepository(WeatherMarketSnapshot);
    const tickRepo = ds.getRepository(WeatherBucketTick);
    await seedSnapshot(snapRepo, tickRepo, {
      city: 'london', recordedAt: '2026-01-01T00:00:00Z',
      bucketCount: 1, totalBucketCount: 3, yesPrice: 0.5, noPrice: 0.5,
    });
    await seedSnapshot(snapRepo, tickRepo, {
      city: 'paris', recordedAt: '2026-01-01T00:30:00Z',
      bucketCount: 1, totalBucketCount: 1, yesPrice: 0.5, noPrice: 0.5,
    });

    const stats = await computeWeatherFidelityStats(ds, params({ cities: ['london'] }));
    expect(stats.snapshots).toBe(1);
    expect(stats.inactiveBucketsExcluded).toBe(2);
  });
});

describe('computeWeatherFidelityStats (§12.2)', () => {
  let ds: DataSource;

  beforeEach(async () => {
    ds = await initializeDataSource(createTestDataSource());
  });

  afterEach(async () => {
    await ds.destroy();
  });

  it('computes inactiveBucketsExcluded, price nulls and per-day rates', async () => {
    const snapRepo = ds.getRepository(WeatherMarketSnapshot);
    const tickRepo = ds.getRepository(WeatherBucketTick);
    const histRepo = ds.getRepository(WeatherForecastHistory);

    // Snapshot 1 : 1 bucket actif sur 3 (2 exclus) — 1 tick avec yesPrice null.
    const snap1 = await snapRepo.save(
      snapRepo.create({
        city: 'london', cityNormalized: 'london', targetDateIso: '2026-01-01',
        metric: 'highest_temp', forecastMean: 12, forecastStdDev: 1.5,
        bucketCount: 1, totalBucketCount: 3, recordedAt: new Date('2026-01-01T00:00:00Z'),
      }),
    );
    await tickRepo.save(
      tickRepo.create({
        snapshotId: snap1.id, conditionId: 'c1', eventSlug: 'e', question: 'q',
        bucketComparison: 'or_above', bucketTarget: 12, bucketLow: null, bucketHigh: null,
        yesPrice: null, noPrice: 0.5, yesTokenId: 'y', noTokenId: 'n',
        volume: 1, volume24hr: 1, liquidityClob: 1,
        acceptingOrders: true, closed: false, endDate: null,
        recordedAt: new Date('2026-01-01T00:00:00Z'),
        city: 'london', cityNormalized: 'london', targetDateIso: '2026-01-01', metric: 'highest_temp',
      }),
    );

    // Snapshot 2 : 2 buckets actifs sur 2 (0 exclus) — 1 tick avec noPrice null.
    const snap2 = await snapRepo.save(
      snapRepo.create({
        city: 'london', cityNormalized: 'london', targetDateIso: '2026-01-02',
        metric: 'highest_temp', forecastMean: 13, forecastStdDev: 1.5,
        bucketCount: 2, totalBucketCount: 2, recordedAt: new Date('2026-01-02T00:00:00Z'),
      }),
    );
    await tickRepo.save(
      tickRepo.create({
        snapshotId: snap2.id, conditionId: 'c2', eventSlug: 'e', question: 'q',
        bucketComparison: 'or_above', bucketTarget: 13, bucketLow: null, bucketHigh: null,
        yesPrice: 0.4, noPrice: null, yesTokenId: 'y', noTokenId: 'n',
        volume: 1, volume24hr: 1, liquidityClob: 1,
        acceptingOrders: true, closed: false, endDate: null,
        recordedAt: new Date('2026-01-02T00:00:00Z'),
        city: 'london', cityNormalized: 'london', targetDateIso: '2026-01-02', metric: 'highest_temp',
      }),
    );

    // 2 révisions forecast sur 2 jours.
    await histRepo.save(
      histRepo.create({
        city: 'london', forecastDate: new Date('2026-01-01T12:00:00Z'),
        metric: 'highest_temp', forecastMean: 12, forecastStdDev: 1.5,
        modelValuesJson: '{}', latitude: 51.5, longitude: -0.1,
        fetchedAt: new Date('2026-01-01T00:00:00Z'),
      }),
    );
    await histRepo.save(
      histRepo.create({
        city: 'london', forecastDate: new Date('2026-01-02T12:00:00Z'),
        metric: 'highest_temp', forecastMean: 13, forecastStdDev: 1.5,
        modelValuesJson: '{}', latitude: 51.5, longitude: -0.1,
        fetchedAt: new Date('2026-01-02T00:00:00Z'),
      }),
    );

    const stats = await computeWeatherFidelityStats(ds, params());
    expect(stats.inactiveBucketsExcluded).toBe(2); // (3-1) + (2-2)
    expect(stats.incompleteCityDates).toBe(1); // seul snap1 a des exclus
    expect(stats.yesPriceNulls).toBe(1);
    expect(stats.noPriceNulls).toBe(1);
    expect(stats.snapshots).toBe(2);
    expect(stats.snapshotsPerDay).toBe(1); // 2 snapshots / 2 jours
    expect(stats.forecastRevisions).toBe(2);
    expect(stats.forecastRevisionsPerDay).toBe(1);
    expect(stats.missingSnapshots).toBe(0);
  });

  it('detects missingSnapshots when a forecast has no matching snapshot', async () => {
    const snapRepo = ds.getRepository(WeatherMarketSnapshot);
    const histRepo = ds.getRepository(WeatherForecastHistory);

    await snapRepo.save(
      snapRepo.create({
        city: 'london', cityNormalized: 'london', targetDateIso: '2026-01-01',
        metric: 'highest_temp', forecastMean: 12, forecastStdDev: 1.5,
        bucketCount: 1, totalBucketCount: 1, recordedAt: new Date('2026-01-01T00:00:00Z'),
      }),
    );
    // Forecast pour une ville/date sans snapshot.
    await histRepo.save(
      histRepo.create({
        city: 'paris', forecastDate: new Date('2026-01-01T12:00:00Z'),
        metric: 'highest_temp', forecastMean: 20, forecastStdDev: 1.5,
        modelValuesJson: '{}', latitude: 48.8, longitude: 2.3,
        fetchedAt: new Date('2026-01-01T00:00:00Z'),
      }),
    );

    const stats = await computeWeatherFidelityStats(ds, params());
    expect(stats.missingSnapshots).toBe(1);
  });

  it('applies the city filter to all sources', async () => {
    const snapRepo = ds.getRepository(WeatherMarketSnapshot);
    const histRepo = ds.getRepository(WeatherForecastHistory);

    for (const city of ['london', 'paris']) {
      await snapRepo.save(
        snapRepo.create({
          city, cityNormalized: city, targetDateIso: '2026-01-01',
          metric: 'highest_temp', forecastMean: 12, forecastStdDev: 1.5,
          bucketCount: 1, totalBucketCount: 3, recordedAt: new Date('2026-01-01T00:00:00Z'),
        }),
      );
      await histRepo.save(
        histRepo.create({
          city, forecastDate: new Date('2026-01-01T12:00:00Z'),
          metric: 'highest_temp', forecastMean: 12, forecastStdDev: 1.5,
          modelValuesJson: '{}', latitude: 51.5, longitude: -0.1,
          fetchedAt: new Date('2026-01-01T00:00:00Z'),
        }),
      );
    }

    const stats = await computeWeatherFidelityStats(ds, params({ cities: ['paris'] }));
    expect(stats.snapshots).toBe(1);
    expect(stats.forecastRevisions).toBe(1);
    expect(stats.inactiveBucketsExcluded).toBe(2); // (3-1) pour paris
  });
});

describe('computeWeatherFidelityStats (§12.2)', () => {
  let ds: DataSource;

  beforeEach(async () => {
    ds = await initializeDataSource(createTestDataSource());
  });

  afterEach(async () => {
    await ds.destroy();
  });

  it('computes inactive buckets, price nulls, snapshots and revisions', async () => {
    const snapRepo = ds.getRepository(WeatherMarketSnapshot);
    const tickRepo = ds.getRepository(WeatherBucketTick);
    const histRepo = ds.getRepository(WeatherForecastHistory);

    // Snapshot 1 : 1 bucket actif sur 3 (2 inactifs exclus), 1 tick yes null.
    const snap1 = await snapRepo.save(
      snapRepo.create({
        city: 'london', cityNormalized: 'london', targetDateIso: '2026-01-01',
        metric: 'highest_temp', forecastMean: 12, forecastStdDev: 1.5,
        bucketCount: 1, totalBucketCount: 3, recordedAt: new Date('2026-01-01T00:00:00Z'),
      }),
    );
    await tickRepo.save(
      tickRepo.create({
        snapshotId: snap1.id, conditionId: 'c1', eventSlug: 'e', question: 'q',
        bucketComparison: 'or_above', bucketTarget: 12, bucketLow: null, bucketHigh: null,
        yesPrice: null, noPrice: 0.5, yesTokenId: 'y', noTokenId: 'n',
        volume: 1, volume24hr: 1, liquidityClob: 1,
        acceptingOrders: true, closed: false, endDate: null,
        recordedAt: new Date('2026-01-01T00:00:00Z'),
        city: 'london', cityNormalized: 'london', targetDateIso: '2026-01-01', metric: 'highest_temp',
      }),
    );

    // Snapshot 2 : complet (0 inactif), tick no null.
    const snap2 = await snapRepo.save(
      snapRepo.create({
        city: 'paris', cityNormalized: 'paris', targetDateIso: '2026-01-01',
        metric: 'highest_temp', forecastMean: 20, forecastStdDev: 1,
        bucketCount: 2, totalBucketCount: 2, recordedAt: new Date('2026-01-01T12:00:00Z'),
      }),
    );
    await tickRepo.save(
      tickRepo.create({
        snapshotId: snap2.id, conditionId: 'c2', eventSlug: 'e', question: 'q',
        bucketComparison: 'or_above', bucketTarget: 20, bucketLow: null, bucketHigh: null,
        yesPrice: 0.5, noPrice: null, yesTokenId: 'y', noTokenId: 'n',
        volume: 1, volume24hr: 1, liquidityClob: 1,
        acceptingOrders: true, closed: false, endDate: null,
        recordedAt: new Date('2026-01-01T12:00:00Z'),
        city: 'paris', cityNormalized: 'paris', targetDateIso: '2026-01-01', metric: 'highest_temp',
      }),
    );

    // 2 révisions forecast (même jour).
    for (const at of ['2026-01-01T00:00:00Z', '2026-01-01T06:00:00Z']) {
      await histRepo.save(
        histRepo.create({
          city: 'london', forecastDate: new Date('2026-01-01T12:00:00Z'),
          metric: 'highest_temp', forecastMean: 12, forecastStdDev: 1.5,
          modelValuesJson: '{}', latitude: 51.5, longitude: -0.1,
          fetchedAt: new Date(at),
        }),
      );
    }

    const stats = await computeWeatherFidelityStats(ds, params());
    expect(stats.inactiveBucketsExcluded).toBe(2);
    expect(stats.incompleteCityDates).toBe(1);
    expect(stats.yesPriceNulls).toBe(1);
    expect(stats.noPriceNulls).toBe(1);
    expect(stats.snapshots).toBe(2);
    expect(stats.snapshotsPerDay).toBe(2);
    expect(stats.forecastRevisions).toBe(2);
    expect(stats.forecastRevisionsPerDay).toBe(2);
    // london|2026-01-01 a un snapshot → pas de gap.
    expect(stats.missingSnapshots).toBe(0);
  });

  it('detects missing snapshots for city/date with forecast but no snapshot', async () => {
    const snapRepo = ds.getRepository(WeatherMarketSnapshot);
    const histRepo = ds.getRepository(WeatherForecastHistory);

    await snapRepo.save(
      snapRepo.create({
        city: 'london', cityNormalized: 'london', targetDateIso: '2026-01-01',
        metric: 'highest_temp', forecastMean: 12, forecastStdDev: 1.5,
        bucketCount: 0, totalBucketCount: 0, recordedAt: new Date('2026-01-01T00:00:00Z'),
      }),
    );
    // Forecast pour paris|2026-01-02 sans snapshot correspondant.
    await histRepo.save(
      histRepo.create({
        city: 'paris', forecastDate: new Date('2026-01-02T12:00:00Z'),
        metric: 'highest_temp', forecastMean: 20, forecastStdDev: 1,
        modelValuesJson: '{}', latitude: 48.8, longitude: 2.3,
        fetchedAt: new Date('2026-01-01T00:00:00Z'),
      }),
    );

    const stats = await computeWeatherFidelityStats(ds, params());
    expect(stats.missingSnapshots).toBe(1);
  });

  it('applies the city filter to the stats', async () => {
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
          snapshotId: snap.id, conditionId: `c-${city}`, eventSlug: 'e', question: 'q',
          bucketComparison: 'or_above', bucketTarget: 12, bucketLow: null, bucketHigh: null,
          yesPrice: 0.5, noPrice: 0.5, yesTokenId: 'y', noTokenId: 'n',
          volume: 1, volume24hr: 1, liquidityClob: 1,
          acceptingOrders: true, closed: false, endDate: null,
          recordedAt: new Date('2026-01-01T00:00:00Z'),
          city, cityNormalized: city, targetDateIso: '2026-01-01', metric: 'highest_temp',
        }),
      );
    }
    const stats = await computeWeatherFidelityStats(ds, params({ cities: ['paris'] }));
    expect(stats.snapshots).toBe(1);
    expect(stats.inactiveBucketsExcluded).toBe(2);
    expect(stats.yesPriceNulls).toBe(0);
  });
});

describe('computeWeatherFidelityStats (§12.2)', () => {
  let ds: DataSource;

  beforeEach(async () => {
    ds = await initializeDataSource(createTestDataSource());
  });

  afterEach(async () => {
    await ds.destroy();
  });

  async function seedSnapshot(opts: {
    city: string;
    recordedAt: string;
    bucketCount: number;
    totalBucketCount: number;
    targetDateIso?: string;
  }) {
    const snapRepo = ds.getRepository(WeatherMarketSnapshot);
    return snapRepo.save(
      snapRepo.create({
        city: opts.city,
        cityNormalized: opts.city,
        targetDateIso: opts.targetDateIso ?? '2026-01-01',
        metric: 'highest_temp',
        forecastMean: 12,
        forecastStdDev: 1.5,
        bucketCount: opts.bucketCount,
        totalBucketCount: opts.totalBucketCount,
        recordedAt: new Date(opts.recordedAt),
      }),
    );
  }

  async function seedTick(snapId: number, yesPrice: number | null, noPrice: number | null) {
    const tickRepo = ds.getRepository(WeatherBucketTick);
    await tickRepo.save(
      tickRepo.create({
        snapshotId: snapId,
        conditionId: `c-${snapId}-${yesPrice}`,
        eventSlug: 'e',
        question: 'q',
        bucketComparison: 'or_above',
        bucketTarget: 12,
        bucketLow: null,
        bucketHigh: null,
        yesPrice,
        noPrice,
        yesTokenId: 'y',
        noTokenId: 'n',
        volume: 1,
        volume24hr: 1,
        liquidityClob: 1,
        acceptingOrders: true,
        closed: false,
        endDate: null,
        recordedAt: new Date('2026-01-01T00:00:00Z'),
        city: 'london',
        cityNormalized: 'london',
        targetDateIso: '2026-01-01',
        metric: 'highest_temp',
      }),
    );
  }

  it('computes inactiveBucketsExcluded and incompleteCityDates', async () => {
    await seedSnapshot({ city: 'london', recordedAt: '2026-01-01T00:00:00Z', bucketCount: 1, totalBucketCount: 3 });
    await seedSnapshot({ city: 'paris', recordedAt: '2026-01-01T00:00:00Z', bucketCount: 2, totalBucketCount: 2 });
    const stats = await computeWeatherFidelityStats(ds, params());
    expect(stats.inactiveBucketsExcluded).toBe(2); // (3-1) + (2-2)
    expect(stats.incompleteCityDates).toBe(1); // london only
  });

  it('counts yesPriceNulls and noPriceNulls', async () => {
    const snap = await seedSnapshot({ city: 'london', recordedAt: '2026-01-01T00:00:00Z', bucketCount: 2, totalBucketCount: 2 });
    await seedTick(snap.id, null, 0.5);
    await seedTick(snap.id, 0.5, null);
    const stats = await computeWeatherFidelityStats(ds, params());
    expect(stats.yesPriceNulls).toBe(1);
    expect(stats.noPriceNulls).toBe(1);
  });

  it('computes snapshotsPerDay and forecastRevisionsPerDay', async () => {
    await seedSnapshot({ city: 'london', recordedAt: '2026-01-01T00:00:00Z', bucketCount: 1, totalBucketCount: 1 });
    await seedSnapshot({ city: 'london', recordedAt: '2026-01-01T12:00:00Z', bucketCount: 1, totalBucketCount: 1 });
    const histRepo = ds.getRepository(WeatherForecastHistory);
    await histRepo.save(
      histRepo.create({
        city: 'london',
        forecastDate: new Date('2026-01-01T12:00:00Z'),
        metric: 'highest_temp',
        forecastMean: 12,
        forecastStdDev: 1.5,
        modelValuesJson: '{}',
        latitude: 51.5,
        longitude: -0.1,
        fetchedAt: new Date('2026-01-01T00:00:00Z'),
      }),
    );
    const stats = await computeWeatherFidelityStats(ds, params());
    expect(stats.snapshots).toBe(2);
    expect(stats.snapshotsPerDay).toBe(2);
    expect(stats.forecastRevisions).toBe(1);
    expect(stats.forecastRevisionsPerDay).toBe(1);
  });

  it('detects missingSnapshots (forecast without snapshot)', async () => {
    const histRepo = ds.getRepository(WeatherForecastHistory);
    await histRepo.save(
      histRepo.create({
        city: 'london',
        forecastDate: new Date('2026-01-01T12:00:00Z'),
        metric: 'highest_temp',
        forecastMean: 12,
        forecastStdDev: 1.5,
        modelValuesJson: '{}',
        latitude: 51.5,
        longitude: -0.1,
        fetchedAt: new Date('2026-01-01T00:00:00Z'),
      }),
    );
    const stats = await computeWeatherFidelityStats(ds, params());
    expect(stats.missingSnapshots).toBe(1);
  });
});

describe('computeWeatherFidelityStats (§12.2)', () => {
  let ds: DataSource;

  beforeEach(async () => {
    ds = await initializeDataSource(createTestDataSource());
  });

  afterEach(async () => {
    await ds.destroy();
  });

  async function seedSnapshot(opts: {
    city: string;
    recordedAt: string;
    bucketCount: number;
    totalBucketCount: number;
    targetDateIso: string;
  }) {
    const snapRepo = ds.getRepository(WeatherMarketSnapshot);
    return snapRepo.save(
      snapRepo.create({
        city: opts.city,
        cityNormalized: opts.city,
        targetDateIso: opts.targetDateIso,
        metric: 'highest_temp',
        forecastMean: 12,
        forecastStdDev: 1.5,
        bucketCount: opts.bucketCount,
        totalBucketCount: opts.totalBucketCount,
        recordedAt: new Date(opts.recordedAt),
      }),
    );
  }

  async function seedTick(opts: {
    snapshotId: number;
    yesPrice: number | null;
    noPrice: number | null;
    recordedAt: string;
    city: string;
  }) {
    const tickRepo = ds.getRepository(WeatherBucketTick);
    await tickRepo.save(
      tickRepo.create({
        snapshotId: opts.snapshotId,
        conditionId: `c-${opts.recordedAt}-${opts.snapshotId}`,
        eventSlug: 'e',
        question: 'q',
        bucketComparison: 'or_above',
        bucketTarget: 12,
        bucketLow: null,
        bucketHigh: null,
        yesPrice: opts.yesPrice,
        noPrice: opts.noPrice,
        yesTokenId: 'y',
        noTokenId: 'n',
        volume: 1,
        volume24hr: 1,
        liquidityClob: 1,
        acceptingOrders: true,
        closed: false,
        endDate: null,
        recordedAt: new Date(opts.recordedAt),
        city: opts.city,
        cityNormalized: opts.city,
        targetDateIso: '2026-01-01',
        metric: 'highest_temp',
      }),
    );
  }

  async function seedForecast(opts: {
    city: string;
    fetchedAt: string;
    forecastDate: string;
  }) {
    const histRepo = ds.getRepository(WeatherForecastHistory);
    await histRepo.save(
      histRepo.create({
        city: opts.city,
        forecastDate: new Date(opts.forecastDate),
        metric: 'highest_temp',
        forecastMean: 12,
        forecastStdDev: 1.5,
        modelValuesJson: '{}',
        latitude: 51.5,
        longitude: -0.1,
        fetchedAt: new Date(opts.fetchedAt),
      }),
    );
  }

  it('computes inactiveBucketsExcluded and incompleteCityDates', async () => {
    // 2 snapshots : 1 avec 1 bucket exclu, 1 complet.
    await seedSnapshot({
      city: 'london', recordedAt: '2026-01-01T00:00:00Z',
      bucketCount: 2, totalBucketCount: 3, targetDateIso: '2026-01-01',
    });
    await seedSnapshot({
      city: 'paris', recordedAt: '2026-01-01T00:00:00Z',
      bucketCount: 3, totalBucketCount: 3, targetDateIso: '2026-01-01',
    });
    const stats = await computeWeatherFidelityStats(ds, params());
    expect(stats.inactiveBucketsExcluded).toBe(1);
    expect(stats.incompleteCityDates).toBe(1);
    expect(stats.snapshots).toBe(2);
  });

  it('counts yesPriceNulls and noPriceNulls', async () => {
    const snap = await seedSnapshot({
      city: 'london', recordedAt: '2026-01-01T00:00:00Z',
      bucketCount: 2, totalBucketCount: 2, targetDateIso: '2026-01-01',
    });
    await seedTick({ snapshotId: snap.id, yesPrice: 0.5, noPrice: 0.5, recordedAt: '2026-01-01T00:00:00Z', city: 'london' });
    await seedTick({ snapshotId: snap.id, yesPrice: null, noPrice: 0.5, recordedAt: '2026-01-01T00:00:00Z', city: 'london' });
    await seedTick({ snapshotId: snap.id, yesPrice: 0.5, noPrice: null, recordedAt: '2026-01-01T00:00:00Z', city: 'london' });
    const stats = await computeWeatherFidelityStats(ds, params());
    expect(stats.yesPriceNulls).toBe(1);
    expect(stats.noPriceNulls).toBe(1);
  });

  it('computes forecastRevisionsPerDay and snapshotsPerDay', async () => {
    await seedSnapshot({
      city: 'london', recordedAt: '2026-01-01T00:00:00Z',
      bucketCount: 1, totalBucketCount: 1, targetDateIso: '2026-01-01',
    });
    await seedSnapshot({
      city: 'london', recordedAt: '2026-01-02T00:00:00Z',
      bucketCount: 1, totalBucketCount: 1, targetDateIso: '2026-01-02',
    });
    await seedForecast({ city: 'london', fetchedAt: '2026-01-01T00:00:00Z', forecastDate: '2026-01-01T12:00:00Z' });
    await seedForecast({ city: 'london', fetchedAt: '2026-01-01T06:00:00Z', forecastDate: '2026-01-01T12:00:00Z' });
    const stats = await computeWeatherFidelityStats(ds, params());
    expect(stats.snapshots).toBe(2);
    expect(stats.snapshotsPerDay).toBe(1); // 2 snapshots / 2 jours
    expect(stats.forecastRevisions).toBe(2);
    expect(stats.forecastRevisionsPerDay).toBe(2); // 2 révisions / 1 jour
  });

  it('detects missingSnapshots (forecast without snapshot)', async () => {
    await seedForecast({ city: 'london', fetchedAt: '2026-01-01T00:00:00Z', forecastDate: '2026-01-01T12:00:00Z' });
    const stats = await computeWeatherFidelityStats(ds, params());
    expect(stats.missingSnapshots).toBe(1);
  });

  it('respects the city filter', async () => {
    await seedSnapshot({
      city: 'london', recordedAt: '2026-01-01T00:00:00Z',
      bucketCount: 1, totalBucketCount: 3, targetDateIso: '2026-01-01',
    });
    await seedSnapshot({
      city: 'paris', recordedAt: '2026-01-01T00:00:00Z',
      bucketCount: 1, totalBucketCount: 3, targetDateIso: '2026-01-01',
    });
    const stats = await computeWeatherFidelityStats(ds, params({ cities: ['paris'] }));
    expect(stats.snapshots).toBe(1);
    expect(stats.inactiveBucketsExcluded).toBe(2);
  });
});
