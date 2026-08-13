import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeDataSource } from '../database/data-source.js';
import { createTestDataSource } from '../database/test-data-source.js';
import { WeatherAutoTrackRule } from '../entities/WeatherAutoTrackRule.js';
import { WeatherClobPriceHistory } from '../entities/WeatherClobPriceHistory.js';
import { WeatherHistoryIngestJob } from '../entities/WeatherHistoryIngestJob.js';
import type { MarketListItemDto } from '../polymarket/market-list.js';
import {
  WeatherHistoryIngestConflictError,
  WeatherHistoryIngestService,
} from './weather-history-ingest.service.js';

const discoverMock = vi.hoisted(() => vi.fn());
const fetchPriceHistoryMock = vi.hoisted(() => vi.fn());
const fetchGammaMarketMock = vi.hoisted(() => vi.fn());

vi.mock('../weather/weather-market-discovery.js', async () => {
  const actual = await vi.importActual<typeof import('../weather/weather-market-discovery.js')>(
    '../weather/weather-market-discovery.js',
  );
  return {
    ...actual,
    discoverWeatherMarketsInRange: discoverMock,
  };
});

vi.mock('../polymarket/price-history-client.js', () => ({
  fetchPriceHistory: fetchPriceHistoryMock,
}));

vi.mock('../polymarket/market-metadata.js', async () => {
  const actual =
    await vi.importActual<typeof import('../polymarket/market-metadata.js')>(
      '../polymarket/market-metadata.js',
    );
  return {
    ...actual,
    fetchGammaMarket: fetchGammaMarketMock,
  };
});

function makeMarket(overrides: Partial<MarketListItemDto>): MarketListItemDto {
  return {
    conditionId: 'cond-1',
    question: 'Will the highest temperature in Paris be 25°C on August 8?',
    slug: null,
    eventSlug: 'paris-aug-8',
    icon: null,
    endDate: '2026-08-09T00:00:00.000Z',
    startDate: null,
    volume: null,
    volume24hr: null,
    liquidityClob: null,
    outcomePrices: [],
    outcomes: [],
    acceptingOrders: null,
    closed: true,
    url: '',
    tokenIdYes: 'yes-token',
    tokenIdNo: 'no-token',
    category: null,
    tagSlugs: [],
    cryptoSymbol: null,
    interval: null,
    cryptoCategory: null,
    marketType: 'weather_temperature' as MarketListItemDto['marketType'],
    ...overrides,
  };
}

describe('WeatherHistoryIngestService', () => {
  let ds: Awaited<ReturnType<typeof initializeDataSource>>;
  let service: WeatherHistoryIngestService;

  beforeEach(async () => {
    discoverMock.mockReset();
    fetchPriceHistoryMock.mockReset();
    fetchGammaMarketMock.mockReset();
    fetchGammaMarketMock.mockResolvedValue(null);
    ds = await initializeDataSource(createTestDataSource());
    service = new WeatherHistoryIngestService(ds);
  });

  afterEach(async () => {
    await ds.destroy();
  });

  it('refuses a second active job for the same city', async () => {
    await ds.getRepository(WeatherHistoryIngestJob).save(
      ds.getRepository(WeatherHistoryIngestJob).create({
        city: 'Paris',
        metric: 'highest_temp',
        fromDate: '2026-08-08',
        toDate: '2026-08-09',
        fidelityMinutes: 60,
        status: 'running',
      }),
    );

    await expect(
      service.startIngest({
        city: 'Paris',
        from: new Date('2026-08-08T00:00:00.000Z'),
        to: new Date('2026-08-09T00:00:00.000Z'),
        fidelityMinutes: 60,
      }),
    ).rejects.toBeInstanceOf(WeatherHistoryIngestConflictError);
  });

  it('marks interrupted jobs on boot helper', async () => {
    await ds.getRepository(WeatherHistoryIngestJob).save([
      ds.getRepository(WeatherHistoryIngestJob).create({
        city: 'Paris',
        metric: 'highest_temp',
        fromDate: '2026-08-08',
        toDate: '2026-08-09',
        fidelityMinutes: 60,
        status: 'running',
      }),
      ds.getRepository(WeatherHistoryIngestJob).create({
        city: 'London',
        metric: 'highest_temp',
        fromDate: '2026-08-08',
        toDate: '2026-08-09',
        fidelityMinutes: 60,
        status: 'done',
      }),
    ]);

    const affected = await service.markInterruptedJobs();
    expect(affected).toBe(1);

    const paris = await ds.getRepository(WeatherHistoryIngestJob).findOne({
      where: { city: 'Paris' },
    });
    expect(paris?.status).toBe('error');
    expect(paris?.errorMessage).toBe('interrupted');
  });

  it('runs ingest job and upserts CLOB points for YES and NO', async () => {
    discoverMock.mockResolvedValue({
      markets: [makeMarket({})],
      byCity: [],
    });
    fetchPriceHistoryMock.mockImplementation(async ({ assetId }: { assetId: string }) => {
      if (assetId === 'yes-token') {
        return [{ t: 1_700_000_000, p: 0.42 }];
      }
      return [{ t: 1_700_000_000, p: 0.58 }];
    });

    const started = await service.startIngest({
      city: 'Paris',
      from: new Date('2026-08-08T00:00:00.000Z'),
      to: new Date('2026-08-09T00:00:00.000Z'),
      fidelityMinutes: 60,
    });

    await service.runJob(started.id);

    const job = await service.getJob(started.id);
    expect(job?.status).toBe('done');
    expect(job?.marketsTotal).toBe(1);
    expect(job?.marketsDone).toBe(1);
    expect(job?.pointsUpserted).toBe(2);

    const coverage = await service.getCoverage('Paris');
    expect(coverage.pointCount).toBe(2);
    expect(coverage.targetDates).toContain('2026-08-08');
  });

  it('appends a synthetic settlement point (YES=1.00, NO=0.00) for resolved markets', async () => {
    discoverMock.mockResolvedValue({
      markets: [
        makeMarket({
          closed: true,
          acceptingOrders: false,
          outcomePrices: [
            { outcome: 'Yes', price: 1 },
            { outcome: 'No', price: 0 },
          ],
        }),
      ],
      byCity: [],
    });
    fetchPriceHistoryMock.mockImplementation(async ({ assetId }: { assetId: string }) => {
      if (assetId === 'yes-token') {
        return [{ t: 1_700_000_000, p: 0.42 }];
      }
      return [{ t: 1_700_000_000, p: 0.58 }];
    });

    const started = await service.startIngest({
      city: 'Paris',
      from: new Date('2026-08-08T00:00:00.000Z'),
      to: new Date('2026-08-09T00:00:00.000Z'),
      fidelityMinutes: 60,
    });

    await service.runJob(started.id);

    const rows = await ds.getRepository(WeatherClobPriceHistory).find({
      where: { city: 'Paris' },
      order: { recordedAt: 'ASC' },
    });
    const yesRows = rows.filter((r) => r.side === 'YES');
    const noRows = rows.filter((r) => r.side === 'NO');

    // YES gagnant : un point trade (0.42) + un point settlement à 1.00
    expect(yesRows).toHaveLength(2);
    expect(yesRows[0]!.price).toBeCloseTo(0.42);
    expect(yesRows[1]!.price).toBeCloseTo(1.0);
    // NO perdant : un point trade (0.58) + un point settlement à 0.00
    expect(noRows).toHaveLength(2);
    expect(noRows[0]!.price).toBeCloseTo(0.58);
    expect(noRows[1]!.price).toBeCloseTo(0.0);
  });

  it('resolves the winner via fetchGammaMarket when outcomePrices is empty', async () => {
    // Marché sans outcomePrices (cas réel : Gamma /events ne les renvoie pas
    // toujours) → le slow path doit interroger fetchGammaMarket pour obtenir
    // winningTokenId et injecter le point de settlement.
    discoverMock.mockResolvedValue({
      markets: [makeMarket({ outcomePrices: [] })],
      byCity: [],
    });
    fetchPriceHistoryMock.mockImplementation(async ({ assetId }: { assetId: string }) => {
      if (assetId === 'yes-token') return [{ t: 1_700_000_000, p: 0.55 }];
      return [{ t: 1_700_000_000, p: 0.45 }];
    });
    fetchGammaMarketMock.mockResolvedValue({
      resolved: true,
      winningTokenId: 'yes-token',
      outcomePricesParsed: [],
    });

    const started = await service.startIngest({
      city: 'Paris',
      from: new Date('2026-08-08T00:00:00.000Z'),
      to: new Date('2026-08-09T00:00:00.000Z'),
      fidelityMinutes: 60,
    });

    await service.runJob(started.id);

    expect(fetchGammaMarketMock).toHaveBeenCalledWith('cond-1');

    const rows = await ds.getRepository(WeatherClobPriceHistory).find({
      where: { city: 'Paris' },
      order: { recordedAt: 'ASC' },
    });
    const yesRows = rows.filter((r) => r.side === 'YES');
    // YES gagnant via winningTokenId : trade (0.55) + settlement (1.00)
    expect(yesRows).toHaveLength(2);
    expect(yesRows[1]!.price).toBeCloseTo(1.0);
  });

  it('detects resolution via fetchGammaMarket winningTokenId when outcomePrices is empty', async () => {
    // Market from Gamma /events has empty outcomePrices (common for closed
    // weather markets). The service must fetch the market record and resolve
    // the winner from winningTokenId.
    discoverMock.mockResolvedValue({
      markets: [
        makeMarket({
          closed: true,
          acceptingOrders: false,
          outcomePrices: [],
        }),
      ],
      byCity: [],
    });
    fetchPriceHistoryMock.mockImplementation(async ({ assetId }: { assetId: string }) => {
      if (assetId === 'yes-token') return [{ t: 1_700_000_000, p: 0.42 }];
      return [{ t: 1_700_000_000, p: 0.58 }];
    });
    fetchGammaMarketMock.mockResolvedValue({
      resolved: true,
      winningTokenId: 'yes-token',
      outcomePricesParsed: [],
    });

    const started = await service.startIngest({
      city: 'Paris',
      from: new Date('2026-08-08T00:00:00.000Z'),
      to: new Date('2026-08-09T00:00:00.000Z'),
      fidelityMinutes: 60,
    });

    await service.runJob(started.id);

    const rows = await ds.getRepository(WeatherClobPriceHistory).find({
      where: { city: 'Paris' },
      order: { recordedAt: 'ASC' },
    });
    const yesRows = rows.filter((r) => r.side === 'YES');
    const noRows = rows.filter((r) => r.side === 'NO');

    expect(yesRows).toHaveLength(2);
    expect(yesRows[1]!.price).toBeCloseTo(1.0);
    expect(noRows).toHaveLength(2);
    expect(noRows[1]!.price).toBeCloseTo(0.0);
  });

  it('resolves a settled market even when Gamma reports closed=false', async () => {
    // Gamma ne flippe pas toujours `closed` pour les marchés weather résolus,
    // et discoverWeatherMarketsInRange peut fournir un marché résolu avec
    // closed=false. Le slow path doit quand même injecter le point de
    // settlement en s'appuyant sur gamma.resolved (signal oracle fiable).
    discoverMock.mockResolvedValue({
      markets: [
        makeMarket({
          closed: false,
          acceptingOrders: true,
          outcomePrices: [],
        }),
      ],
      byCity: [],
    });
    fetchPriceHistoryMock.mockImplementation(async ({ assetId }: { assetId: string }) => {
      if (assetId === 'yes-token') return [{ t: 1_700_000_000, p: 0.42 }];
      return [{ t: 1_700_000_000, p: 0.58 }];
    });
    fetchGammaMarketMock.mockResolvedValue({
      resolved: true,
      winningTokenId: 'yes-token',
      outcomePricesParsed: [],
    });

    const started = await service.startIngest({
      city: 'Paris',
      from: new Date('2026-08-08T00:00:00.000Z'),
      to: new Date('2026-08-09T00:00:00.000Z'),
      fidelityMinutes: 60,
    });

    await service.runJob(started.id);

    const rows = await ds.getRepository(WeatherClobPriceHistory).find({
      where: { city: 'Paris' },
      order: { recordedAt: 'ASC' },
    });
    const yesRows = rows.filter((r) => r.side === 'YES');
    const noRows = rows.filter((r) => r.side === 'NO');

    expect(yesRows).toHaveLength(2);
    expect(yesRows[1]!.price).toBeCloseTo(1.0);
    expect(noRows).toHaveLength(2);
    expect(noRows[1]!.price).toBeCloseTo(0.0);
  });

  it('does not inject a settlement point for a live market trading at 0.99', async () => {
    // Un marché ouvert dont le YES trade à 0.99 ne doit PAS recevoir de point
    // de settlement : winningTokenId serait peuplé par le seuil de prix, mais
    // gamma.resolved=false indique que l'oracle n'a pas encore réglé le marché.
    discoverMock.mockResolvedValue({
      markets: [
        makeMarket({
          closed: false,
          acceptingOrders: true,
          outcomePrices: [],
        }),
      ],
      byCity: [],
    });
    fetchPriceHistoryMock.mockImplementation(async ({ assetId }: { assetId: string }) => {
      if (assetId === 'yes-token') return [{ t: 1_700_000_000, p: 0.99 }];
      return [{ t: 1_700_000_000, p: 0.01 }];
    });
    fetchGammaMarketMock.mockResolvedValue({
      resolved: false,
      winningTokenId: 'yes-token',
      outcomePricesParsed: [],
    });

    const started = await service.startIngest({
      city: 'Paris',
      from: new Date('2026-08-08T00:00:00.000Z'),
      to: new Date('2026-08-09T00:00:00.000Z'),
      fidelityMinutes: 60,
    });

    await service.runJob(started.id);

    const rows = await ds.getRepository(WeatherClobPriceHistory).find({
      where: { city: 'Paris' },
      order: { recordedAt: 'ASC' },
    });
    const yesRows = rows.filter((r) => r.side === 'YES');
    const noRows = rows.filter((r) => r.side === 'NO');

    // Aucun point de settlement : un seul point trade par côté.
    expect(yesRows).toHaveLength(1);
    expect(yesRows[0]!.price).toBeCloseTo(0.99);
    expect(noRows).toHaveLength(1);
    expect(noRows[0]!.price).toBeCloseTo(0.01);
  });

  it('lists known cities from auto-track and snapshots union', async () => {
    await ds.getRepository(WeatherAutoTrackRule).save(
      ds.getRepository(WeatherAutoTrackRule).create({
        city: 'Paris',
        metric: 'highest_temp',
        lookAheadDays: 1,
        enabled: true,
      }),
    );

    const cities = await service.listKnownCities();
    expect(cities).toEqual(['Paris']);
  });

  it('marks a job as error when an upsert chunk fails mid-ingest', async () => {
    const manyPoints = Array.from({ length: 1200 }, (_, i) => ({
      t: 1_700_000_000 + i * 60,
      p: 0.42,
    }));
    discoverMock.mockResolvedValue({
      markets: [makeMarket({})],
      byCity: [],
    });
    fetchPriceHistoryMock.mockImplementation(async ({ assetId }: { assetId: string }) => {
      if (assetId === 'yes-token') return manyPoints;
      return [{ t: 1_700_000_000, p: 0.58 }];
    });

    // Reject only inserts targeting weather_clob_price_history — the upsert
    // error must propagate through runJob and mark the job as failed.
    const { InsertQueryBuilder } = await import('typeorm');
    const origExecute = InsertQueryBuilder.prototype.execute;
    const execSpy = vi
      .spyOn(InsertQueryBuilder.prototype, 'execute')
      .mockImplementation(function (this: unknown) {
        const sql = (this as { getSql?: () => string }).getSql?.() ?? '';
        if (sql.includes('weather_clob_price_history')) {
          return Promise.reject(new Error('db down'));
        }
        return origExecute.call(this as never);
      });

    const started = await service.startIngest({
      city: 'Paris',
      from: new Date('2026-08-08T00:00:00.000Z'),
      to: new Date('2026-08-09T00:00:00.000Z'),
      fidelityMinutes: 60,
    });

    await service.runJob(started.id);

    const job = await service.getJob(started.id);
    expect(job?.status).toBe('error');
    expect(job?.errorMessage).toContain('upsert_failed');

    execSpy.mockRestore();
  });

  it('markStaleJobs marks old running jobs but leaves recent ones', async () => {
    const repo = ds.getRepository(WeatherHistoryIngestJob);
    const stale = await repo.save(
      repo.create({
        city: 'Paris',
        metric: 'highest_temp',
        fromDate: '2026-08-08',
        toDate: '2026-08-09',
        fidelityMinutes: 60,
        status: 'running',
        startedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
      }),
    );
    const fresh = await repo.save(
      repo.create({
        city: 'London',
        metric: 'highest_temp',
        fromDate: '2026-08-08',
        toDate: '2026-08-09',
        fidelityMinutes: 60,
        status: 'running',
        startedAt: new Date(),
      }),
    );

    const affected = await service.markStaleJobs(60 * 60 * 1000);
    expect(affected).toBe(1);

    const staleAfter = await repo.findOne({ where: { id: stale.id } });
    expect(staleAfter?.status).toBe('error');
    expect(staleAfter?.errorMessage).toBe('stale_timeout');
    const freshAfter = await repo.findOne({ where: { id: fresh.id } });
    expect(freshAfter?.status).toBe('running');
  });

  it('stores a second interval as a distinct series (no overwrite)', async () => {
    const repo = ds.getRepository(WeatherClobPriceHistory);
    const base = {
      city: 'Paris',
      targetDate: '2026-08-08',
      metric: 'highest_temp',
      conditionId: 'cond-1',
      eventSlug: 'paris-aug-8',
      question: 'Will the highest temperature in Paris be 25°C on August 8?',
      bucketComparison: 'exact',
      bucketTarget: 25,
      bucketLow: null,
      bucketHigh: null,
      side: 'YES' as const,
      tokenId: 'yes-token',
      price: 0.5,
      recordedAt: new Date('2026-08-08T12:00:00.000Z'),
      ingestJobId: null,
    };

    await repo.save(repo.create({ ...base, fidelityMinutes: 15 }));
    await repo.save(repo.create({ ...base, fidelityMinutes: 60 }));

    const rows = await repo.find({ where: { city: 'Paris' } });
    expect(rows).toHaveLength(2);
    const fids = rows.map((r) => r.fidelityMinutes).sort((a, b) => a - b);
    expect(fids).toEqual([15, 60]);
  });

  it('deleteCityInterval removes only the rows of that interval', async () => {
    const repo = ds.getRepository(WeatherClobPriceHistory);
    const base = {
      city: 'Paris',
      targetDate: '2026-08-08',
      metric: 'highest_temp',
      conditionId: 'cond-1',
      eventSlug: 'paris-aug-8',
      question: 'Will the highest temperature in Paris be 25°C on August 8?',
      bucketComparison: 'exact',
      bucketTarget: 25,
      bucketLow: null,
      bucketHigh: null,
      side: 'YES' as const,
      tokenId: 'yes-token',
      price: 0.5,
      recordedAt: new Date('2026-08-08T12:00:00.000Z'),
      ingestJobId: null,
    };

    await repo.save(repo.create({ ...base, fidelityMinutes: 15 }));
    await repo.save(repo.create({ ...base, fidelityMinutes: 60 }));

    const deleted = await service.deleteCityInterval('Paris', 15);
    expect(deleted).toBe(1);

    const remaining = await repo.find({ where: { city: 'Paris' } });
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.fidelityMinutes).toBe(60);
  });

  it('deleteCityInterval throws on invalid fidelity', async () => {
    await expect(service.deleteCityInterval('Paris', 0)).rejects.toThrow('invalid_fidelity');
    await expect(service.deleteCityInterval('Paris', -5)).rejects.toThrow('invalid_fidelity');
    await expect(service.deleteCityInterval('Paris', Number.NaN)).rejects.toThrow(
      'invalid_fidelity',
    );
  });

  it('getCoverage reports intervals with their point counts', async () => {
    const repo = ds.getRepository(WeatherClobPriceHistory);
    const base = {
      city: 'Paris',
      targetDate: '2026-08-08',
      metric: 'highest_temp',
      conditionId: 'cond-1',
      eventSlug: 'paris-aug-8',
      question: 'Will the highest temperature in Paris be 25°C on August 8?',
      bucketComparison: 'exact',
      bucketTarget: 25,
      bucketLow: null,
      bucketHigh: null,
      side: 'YES' as const,
      tokenId: 'yes-token',
      price: 0.5,
      recordedAt: new Date('2026-08-08T12:00:00.000Z'),
      ingestJobId: null,
    };

    await repo.save(repo.create({ ...base, fidelityMinutes: 15 }));
    await repo.save(
      repo.create({
        ...base,
        fidelityMinutes: 15,
        recordedAt: new Date('2026-08-08T13:00:00.000Z'),
      }),
    );
    await repo.save(repo.create({ ...base, fidelityMinutes: 60 }));

    const coverage = await service.getCoverage('Paris');
    expect(coverage.pointCount).toBe(3);
    expect(coverage.intervals).toEqual([
      { fidelityMinutes: 15, pointCount: 2 },
      { fidelityMinutes: 60, pointCount: 1 },
    ]);
  });

  it('stores two metrics on the same conditionId as distinct series (no overwrite)', async () => {
    const repo = ds.getRepository(WeatherClobPriceHistory);
    const base = {
      city: 'Paris',
      targetDate: '2026-08-08',
      conditionId: 'cond-1',
      eventSlug: 'paris-aug-8',
      question: 'Will the highest temperature in Paris be 25°C on August 8?',
      bucketComparison: 'exact',
      bucketTarget: 25,
      bucketLow: null,
      bucketHigh: null,
      side: 'YES' as const,
      tokenId: 'yes-token',
      price: 0.5,
      recordedAt: new Date('2026-08-08T12:00:00.000Z'),
      fidelityMinutes: 60,
      ingestJobId: null,
    };

    await repo.save(repo.create({ ...base, metric: 'highest_temp' }));
    await repo.save(repo.create({ ...base, metric: 'lowest_temp' }));

    const rows = await repo.find({ where: { city: 'Paris' } });
    expect(rows).toHaveLength(2);
    const metrics = rows.map((r) => r.metric).sort();
    expect(metrics).toEqual(['highest_temp', 'lowest_temp']);
  });
});
