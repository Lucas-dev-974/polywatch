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
});
