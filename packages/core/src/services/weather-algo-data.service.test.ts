import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initializeDataSource } from '../database/data-source.js';
import { createTestDataSource } from '../database/test-data-source.js';
import { WeatherBucketTick } from '../entities/WeatherBucketTick.js';
import { WeatherMarketSnapshot } from '../entities/WeatherMarketSnapshot.js';
import { WeatherClobPriceHistory } from '../entities/WeatherClobPriceHistory.js';
import { WeatherAlgoDataService } from './weather-algo-data.service.js';

describe('WeatherAlgoDataService — bucket ticks timeline', () => {
  let ds: Awaited<ReturnType<typeof initializeDataSource>>;
  let service: WeatherAlgoDataService;

  beforeEach(async () => {
    ds = await initializeDataSource(createTestDataSource());
    service = new WeatherAlgoDataService(ds);
  });

  afterEach(async () => {
    await ds.destroy();
  });

  async function seedSnapshot(overrides: Partial<WeatherMarketSnapshot> = {}) {
    const repo = ds.getRepository(WeatherMarketSnapshot);
    return repo.save(
      repo.create({
        city: 'london',
        cityNormalized: 'london',
        targetDateIso: '2026-01-01',
        metric: 'temp',
        forecastMean: 10,
        forecastStdDev: 1.5,
        bucketCount: 3,
        totalBucketCount: 5,
        recordedAt: new Date('2026-01-01T00:00:00.000Z'),
        ...overrides,
      }),
    );
  }

  async function seedTick(snapshotId: number, overrides: Partial<WeatherBucketTick> = {}) {
    const repo = ds.getRepository(WeatherBucketTick);
    return repo.save(
      repo.create({
        snapshotId,
        city: 'london',
        cityNormalized: 'london',
        targetDateIso: '2026-01-01',
        metric: 'temp',
        fidelityMinutes: 30,
        conditionId: 'cond-1',
        eventSlug: 'evt',
        question: 'q?',
        bucketComparison: 'or_above',
        bucketTarget: 10,
        bucketLow: null,
        bucketHigh: null,
        yesPrice: 0.5,
        noPrice: 0.5,
        yesTokenId: 'yes',
        noTokenId: 'no',
        volume: 100,
        volume24hr: 50,
        liquidityClob: 200,
        acceptingOrders: true,
        closed: false,
        endDate: null,
        recordedAt: new Date('2026-01-01T00:00:00.000Z'),
        ...overrides,
      }),
    );
  }

  it('TC1 — snapshot unique + tick unique → 1 ville, 1 bucket, 1 point', async () => {
    const snap = await seedSnapshot();
    await seedTick(snap.id, { yesPrice: 0.42 });

    const res = await service.getBucketTicksTimeline({
      targetDateIso: '2026-01-01',
    });

    expect(res.dates).toHaveLength(1);
    const date = res.dates[0]!;
    expect(date.targetDateIso).toBe('2026-01-01');
    expect(date.cities).toHaveLength(1);
    const city = date.cities[0]!;
    expect(city.cityNormalized).toBe('london');
    expect(city.buckets).toHaveLength(1);
    expect(city.bucketCount).toBe(1);
    const bucket = city.buckets[0]!;
    expect(bucket.conditionId).toBe('cond-1');
    expect(bucket.bucketComparison).toBe('or_above');
    expect(bucket.bucketTarget).toBe(10);
    expect(bucket.series).toHaveLength(1);
    expect(bucket.series[0]!.yesPrice).toBeCloseTo(0.42, 5);
  });

  it('TC2 — 2 snapshots + 2 ticks même bucket → 2 points dans la même série', async () => {
    const snap1 = await seedSnapshot({ recordedAt: new Date('2026-01-01T00:00:00.000Z') });
    await seedTick(snap1.id, {
      recordedAt: new Date('2026-01-01T00:00:00.000Z'),
      yesPrice: 0.3,
    });
    const snap2 = await seedSnapshot({ recordedAt: new Date('2026-01-01T01:00:00.000Z') });
    await seedTick(snap2.id, {
      recordedAt: new Date('2026-01-01T01:00:00.000Z'),
      yesPrice: 0.6,
    });

    const res = await service.getBucketTicksTimeline({
      targetDateIso: '2026-01-01',
    });

    const city = res.dates[0]!.cities[0]!;
    expect(city.buckets).toHaveLength(1);
    expect(city.bucketCount).toBe(1);
    expect(city.buckets[0]!.series).toHaveLength(2);
    expect(city.buckets[0]!.series[0]!.yesPrice).toBeCloseTo(0.3, 5);
    expect(city.buckets[0]!.series[1]!.yesPrice).toBeCloseTo(0.6, 5);
  });

  it('TC3 — forecastMean = dernier snapshot (par recordedAt)', async () => {
    await seedSnapshot({
      forecastMean: 8,
      forecastStdDev: 1,
      recordedAt: new Date('2026-01-01T00:00:00.000Z'),
    }).then(async (s) =>
      seedTick(s.id, { recordedAt: new Date('2026-01-01T00:00:00.000Z') }),
    );
    await seedSnapshot({
      forecastMean: 12,
      forecastStdDev: 2,
      recordedAt: new Date('2026-01-01T01:00:00.000Z'),
    }).then(async (s) =>
      seedTick(s.id, { recordedAt: new Date('2026-01-01T01:00:00.000Z') }),
    );

    const res = await service.getBucketTicksTimeline({
      targetDateIso: '2026-01-01',
    });

    const city = res.dates[0]!.cities[0]!;
    // Le snapshot le plus récent (recordedAt le plus grand) doit l'emporter.
    expect(city.forecastMean).toBeCloseTo(12, 5);
    expect(city.forecastStdDev).toBeCloseTo(2, 5);
  });

  it('TC4 — maxTicks clamp limite le nombre de ticks retournés', async () => {
    const snap = await seedSnapshot();
    await seedTick(snap.id, { yesPrice: 0.1, recordedAt: new Date('2026-01-01T00:00:01.000Z') });
    await seedTick(snap.id, { yesPrice: 0.2, recordedAt: new Date('2026-01-01T00:00:02.000Z') });
    await seedTick(snap.id, { yesPrice: 0.3, recordedAt: new Date('2026-01-01T00:00:03.000Z') });

    const res = await service.getBucketTicksTimeline({
      targetDateIso: '2026-01-01',
      maxTicks: 1,
    });

    const city = res.dates[0]!.cities[0]!;
    expect(city.buckets[0]!.series).toHaveLength(1);
  });

  it('TC5 — targetDateIso vide → dates: []', async () => {
    const res = await service.getBucketTicksTimeline({ targetDateIso: '' });
    expect(res.dates).toEqual([]);
  });

  it('filtre la timeline par intervalle (fidelityMinutes)', async () => {
    const snap = await seedSnapshot();
    await seedTick(snap.id, { fidelityMinutes: 15, yesPrice: 0.3, conditionId: 'cond-15' });
    await seedTick(snap.id, { fidelityMinutes: 60, yesPrice: 0.6, conditionId: 'cond-60' });

    const all = await service.getBucketTicksTimeline({ targetDateIso: '2026-01-01' });
    expect(all.dates[0]!.cities[0]!.buckets).toHaveLength(2);

    const filtered = await service.getBucketTicksTimeline({
      targetDateIso: '2026-01-01',
      fidelityMinutes: 15,
    });
    const buckets = filtered.dates[0]!.cities[0]!.buckets;
    expect(buckets).toHaveLength(1);
    expect(buckets[0]!.conditionId).toBe('cond-15');
  });

  it('listBucketTickDates — agrège par date cible', async () => {
    const snap = await seedSnapshot({ targetDateIso: '2026-01-02' });
    await seedTick(snap.id, { targetDateIso: '2026-01-02' });
    await seedTick(snap.id, { conditionId: 'cond-2', targetDateIso: '2026-01-02' });

    const res = await service.listBucketTickDates();
    expect(res.dates).toHaveLength(1);
    const entry = res.dates[0]!;
    expect(entry.targetDateIso).toBe('2026-01-02');
    expect(entry.cityCount).toBe(1);
    expect(entry.tickCount).toBe(2);
  });
});

describe('WeatherAlgoDataService — clob price history timeline', () => {
  let ds: Awaited<ReturnType<typeof initializeDataSource>>;
  let service: WeatherAlgoDataService;

  beforeEach(async () => {
    ds = await initializeDataSource(createTestDataSource());
    service = new WeatherAlgoDataService(ds);
  });

  afterEach(async () => {
    await ds.destroy();
  });

  async function seedClob(overrides: Partial<WeatherClobPriceHistory> = {}) {
    const repo = ds.getRepository(WeatherClobPriceHistory);
    return repo.save(
      repo.create({
        city: 'london',
        targetDate: '2026-01-01',
        metric: 'temp',
        conditionId: 'cond-1',
        eventSlug: 'evt',
        question: 'q?',
        bucketComparison: 'or_above',
        bucketTarget: 10,
        bucketLow: null,
        bucketHigh: null,
        side: 'YES',
        tokenId: 'yes-token',
        price: 0.5,
        recordedAt: new Date('2026-01-01T00:00:00.000Z'),
        fidelityMinutes: 60,
        ingestJobId: null,
        ...overrides,
      }),
    );
  }

  it('TC1 — 1 enregistrement → 1 ville, 1 bucket, 1 point (avec side)', async () => {
    await seedClob({ price: 0.42, side: 'YES' });

    const res = await service.getClobPriceHistoryTimeline({ targetDate: '2026-01-01' });

    expect(res.dates).toHaveLength(1);
    const date = res.dates[0]!;
    expect(date.targetDate).toBe('2026-01-01');
    expect(date.cities).toHaveLength(1);
    const city = date.cities[0]!;
    expect(city.cityNormalized).toBe('london');
    expect(city.buckets).toHaveLength(1);
    expect(city.bucketCount).toBe(1);
    const bucket = city.buckets[0]!;
    expect(bucket.conditionId).toBe('cond-1');
    expect(bucket.bucketComparison).toBe('or_above');
    expect(bucket.bucketTarget).toBe(10);
    expect(bucket.series).toHaveLength(1);
    expect(bucket.series[0]!.price).toBeCloseTo(0.42, 5);
    expect(bucket.series[0]!.side).toBe('YES');
  });

  it('TC2 — 2 enregistrements même bucket → 2 points dans la même série', async () => {
    await seedClob({
      recordedAt: new Date('2026-01-01T00:00:00.000Z'),
      price: 0.3,
      side: 'YES',
    });
    await seedClob({
      recordedAt: new Date('2026-01-01T01:00:00.000Z'),
      price: 0.6,
      side: 'YES',
    });

    const res = await service.getClobPriceHistoryTimeline({ targetDate: '2026-01-01' });

    const city = res.dates[0]!.cities[0]!;
    expect(city.buckets).toHaveLength(1);
    expect(city.bucketCount).toBe(1);
    expect(city.buckets[0]!.series).toHaveLength(2);
    expect(city.buckets[0]!.series[0]!.price).toBeCloseTo(0.3, 5);
    expect(city.buckets[0]!.series[1]!.price).toBeCloseTo(0.6, 5);
  });

  it('TC3 — maxTicks clamp limite le nombre de points retournés', async () => {
    await seedClob({ price: 0.1, recordedAt: new Date('2026-01-01T00:00:01.000Z') });
    await seedClob({ price: 0.2, recordedAt: new Date('2026-01-01T00:00:02.000Z') });
    await seedClob({ price: 0.3, recordedAt: new Date('2026-01-01T00:00:03.000Z') });

    const res = await service.getClobPriceHistoryTimeline({
      targetDate: '2026-01-01',
      maxTicks: 1,
    });

    const city = res.dates[0]!.cities[0]!;
    expect(city.buckets[0]!.series).toHaveLength(1);
  });

  it('TC4 — targetDate vide → dates: []', async () => {
    const res = await service.getClobPriceHistoryTimeline({ targetDate: '' });
    expect(res.dates).toEqual([]);
  });

  it('TC5 — listClobPriceHistoryDates agrège par date cible', async () => {
    await seedClob({ targetDate: '2026-01-02' });
    await seedClob({ targetDate: '2026-01-02', conditionId: 'cond-2' });

    const res = await service.listClobPriceHistoryDates();
    expect(res.dates).toHaveLength(1);
    const entry = res.dates[0]!;
    expect(entry.targetDate).toBe('2026-01-02');
    expect(entry.cityCount).toBe(1);
    expect(entry.tickCount).toBe(2);
  });
});

describe('WeatherAlgoDataService — deleteTableData', () => {
  let ds: Awaited<ReturnType<typeof initializeDataSource>>;
  let service: WeatherAlgoDataService;

  beforeEach(async () => {
    ds = await initializeDataSource(createTestDataSource());
    service = new WeatherAlgoDataService(ds);
  });

  afterEach(async () => {
    await ds.destroy();
  });

  async function seedSnapshot(overrides: Partial<WeatherMarketSnapshot> = {}) {
    const repo = ds.getRepository(WeatherMarketSnapshot);
    return repo.save(
      repo.create({
        city: 'london',
        cityNormalized: 'london',
        targetDateIso: '2026-01-01',
        metric: 'temp',
        forecastMean: 10,
        forecastStdDev: 1.5,
        bucketCount: 3,
        totalBucketCount: 5,
        recordedAt: new Date('2026-01-01T00:00:00.000Z'),
        ...overrides,
      }),
    );
  }

  async function seedTick(snapshotId: number, overrides: Partial<WeatherBucketTick> = {}) {
    const repo = ds.getRepository(WeatherBucketTick);
    return repo.save(
      repo.create({
        snapshotId,
        city: 'london',
        cityNormalized: 'london',
        targetDateIso: '2026-01-01',
        metric: 'temp',
        fidelityMinutes: 30,
        conditionId: 'cond-1',
        eventSlug: 'evt',
        question: 'q?',
        bucketComparison: 'or_above',
        bucketTarget: 10,
        bucketLow: null,
        bucketHigh: null,
        yesPrice: 0.5,
        noPrice: 0.5,
        yesTokenId: 'yes',
        noTokenId: 'no',
        volume: 100,
        volume24hr: 50,
        liquidityClob: 200,
        acceptingOrders: true,
        closed: false,
        endDate: null,
        recordedAt: new Date('2026-01-01T00:00:00.000Z'),
        ...overrides,
      }),
    );
  }

  async function seedClob(overrides: Partial<WeatherClobPriceHistory> = {}) {
    const repo = ds.getRepository(WeatherClobPriceHistory);
    return repo.save(
      repo.create({
        city: 'london',
        targetDate: '2026-01-01',
        metric: 'temp',
        conditionId: 'cond-1',
        eventSlug: 'evt',
        question: 'q?',
        bucketComparison: 'or_above',
        bucketTarget: 10,
        bucketLow: null,
        bucketHigh: null,
        side: 'YES',
        tokenId: 'yes-token',
        price: 0.5,
        recordedAt: new Date('2026-01-01T00:00:00.000Z'),
        fidelityMinutes: 60,
        ingestJobId: null,
        ...overrides,
      }),
    );
  }

  it('supprime les lignes de clob_price_history et retourne le bon compte', async () => {
    await seedClob({ price: 0.3 });
    await seedClob({ price: 0.6, side: 'NO' });

    const res = await service.deleteTableData('clob_price_history');
    expect(res.id).toBe('clob_price_history');
    expect(res.deleted).toBe(2);
    expect(res.cascaded).toBe(0);

    const remaining = await ds.getRepository(WeatherClobPriceHistory).count();
    expect(remaining).toBe(0);
  });

  it('supprime les bucket_ticks seules sans toucher aux snapshots', async () => {
    const snap = await seedSnapshot();
    await seedTick(snap.id, { yesPrice: 0.4 });
    await seedTick(snap.id, { yesPrice: 0.5, conditionId: 'cond-2' });

    const res = await service.deleteTableData('bucket_ticks');
    expect(res.id).toBe('bucket_ticks');
    expect(res.deleted).toBe(2);
    expect(res.cascaded).toBe(0);

    const snapCount = await ds.getRepository(WeatherMarketSnapshot).count();
    expect(snapCount).toBe(1);
  });

  it('supprime market_snapshots ET cascade bucket_ticks', async () => {
    const snap = await seedSnapshot();
    await seedTick(snap.id);
    await seedTick(snap.id, { conditionId: 'cond-2' });

    const res = await service.deleteTableData('market_snapshots');
    expect(res.id).toBe('market_snapshots');
    expect(res.deleted).toBe(1);
    expect(res.cascaded).toBe(2);

    const snapCount = await ds.getRepository(WeatherMarketSnapshot).count();
    const tickCount = await ds.getRepository(WeatherBucketTick).count();
    expect(snapCount).toBe(0);
    expect(tickCount).toBe(0);
  });

  it('filtre la timeline clob par intervalle (fidelityMinutes)', async () => {
    await seedClob({ fidelityMinutes: 15, price: 0.3 });
    await seedClob({ fidelityMinutes: 60, price: 0.6, side: 'NO' });

    const all = await service.getClobPriceHistoryTimeline({
      targetDate: '2026-01-01',
    });
    expect(all.dates[0]!.cities[0]!.buckets[0]!.series).toHaveLength(2);

    const filtered = await service.getClobPriceHistoryTimeline({
      targetDate: '2026-01-01',
      fidelityMinutes: 15,
    });
    const series = filtered.dates[0]!.cities[0]!.buckets[0]!.series;
    expect(series).toHaveLength(1);
    expect(series[0]!.price).toBeCloseTo(0.3);
  });

  it('deleteBucketTickCityInterval — supprime une ville × intervalle sans toucher aux autres', async () => {
    const snap = await seedSnapshot();
    await seedTick(snap.id, { fidelityMinutes: 15, yesPrice: 0.3, conditionId: 'cond-15' });
    await seedTick(snap.id, { fidelityMinutes: 60, yesPrice: 0.6, conditionId: 'cond-60' });
    await seedSnapshot({ city: 'paris', cityNormalized: 'paris', targetDateIso: '2026-01-02' }).then(
      async (s) => seedTick(s.id, { city: 'paris', cityNormalized: 'paris', targetDateIso: '2026-01-02', fidelityMinutes: 15, conditionId: 'cond-paris' }),
    );

    const deleted = await service.deleteBucketTickCityInterval('london', 15);
    expect(deleted).toBe(1);

    const remaining = await ds.getRepository(WeatherBucketTick).find();
    const conds = remaining.map((t) => t.conditionId);
    expect(conds).toEqual(expect.arrayContaining(['cond-60', 'cond-paris']));
    expect(conds).not.toContain('cond-15');
  });

  it('deleteBucketTickCityInterval — rejette un fidelity invalide', async () => {
    await expect(service.deleteBucketTickCityInterval('london', 0)).rejects.toThrow('invalid_fidelity');
  });
});