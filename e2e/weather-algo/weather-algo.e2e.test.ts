import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataSource } from 'typeorm';
import {
  WORKER_QUEUES,
  RedisQueue,
  ReservationService,
  SimulationService,
  MarketService,
  PositionReservation,
} from '@polywatch/core';
import { runWeatherEntryPipeline } from '../../packages/weather-algo/src/processors/weather-entry-pipeline.js';
import { createTestDataSource } from './helpers/database.js';
import { configureWeatherAlgoRisk } from './helpers/risk-config.js';
import { seedWeatherMarketFixture, makeWeatherSignal } from './helpers/fixtures.js';
import { MockRedis } from '../crypto-algo/helpers/redis-mock.js';
import { MockConnectionManager } from '../crypto-algo/helpers/connection-manager-mock.js';
import { QueueSpy } from '../crypto-algo/helpers/queue-spy.js';

// Neutralise the MOS HTTP fetch by pointing the CLOB API to an inert URL.
vi.mock('../../packages/weather-algo/src/config.js', () => ({
  resolvedClobApi: 'http://clob.test',
}));

const WEATHER_QUEUE = WORKER_QUEUES.WEATHER_ORDER_SIGNALS;

describe('weather-algo e2e', () => {
  let ds: DataSource;
  let redis: MockRedis;
  let connectionManager: MockConnectionManager;
  let orderQueue: RedisQueue<unknown>;
  let orderSpy: QueueSpy;
  let fixture: { conditionId: string; tokenIdYes: string; tokenIdNo: string };

  beforeEach(async () => {
    ds = await createTestDataSource();
    redis = new MockRedis();
    connectionManager = new MockConnectionManager();
    connectionManager.setPrice(fixture?.tokenIdYes ?? '0xYES_weather_e2e_paris_33c_01', {
      executableBidVwap: 0.45,
      executableAskVwap: 0.50,
      liquidityStatus: 'ok',
    });
    connectionManager.setOrderBook(
      fixture?.tokenIdYes ?? '0xYES_weather_e2e_paris_33c_01',
      [{ price: 0.45, size: 100 }],
      [{ price: 0.50, size: 100 }],
    );
    orderQueue = new RedisQueue(redis as never, WEATHER_QUEUE, async () => {});
    orderSpy = new QueueSpy(redis, WEATHER_QUEUE);
    await configureWeatherAlgoRisk(ds);
    fixture = await seedWeatherMarketFixture(ds);
  });

  afterEach(async () => {
    await ds.destroy();
    redis.clear();
  });

  it('enqueues a WEATHER_OPEN signal on weather-order-signals queue', async () => {
    const signal = makeWeatherSignal(fixture);
    const result = await runWeatherEntryPipeline({
      signal,
      risk: (await ds.getRepository('WeatherConfig').findOne({ where: {} }))!,
      globalConfig: { realTradingEnabled: false } as never,
      watchlistId: 1,
      connectionManager,
      reservationService: new ReservationService(ds),
      simulationService: new SimulationService(ds),
      marketService: new MarketService(ds),
      orderQueue,
      redisCmd: redis as never,
      ds,
      backendUrl: 'http://localhost:3000',
      serviceToken: 'dev-token',
    });

    expect(result).toBeNull();

    const jobs = orderSpy.all();
    expect(jobs).toHaveLength(1);
    expect(jobs[0].reason).toBe('WEATHER_OPEN');
    expect(jobs[0].mode).toBe('sim');
    expect(jobs[0].side).toBe('BUY');
    expect(jobs[0].quantity).toBeGreaterThan(0);

    const reservations = await ds.getRepository(PositionReservation).find();
    expect(reservations).toHaveLength(1);
    expect(reservations[0].reason).toBe('WEATHER_OPEN');
    expect(reservations[0].mode).toBe('sim');

    const pending = await ds.query(
      `SELECT COUNT(*)::int AS n FROM copied_positions WHERE status = 'pending' AND mode = 'sim'`,
    );
    expect(pending[0]?.n).toBe(1);
  });

  it('returns skip reason when weather-algo is disabled', async () => {
    await configureWeatherAlgoRisk(ds, { weatherAlgoEnabled: false });
    const signal = makeWeatherSignal(fixture);
    const result = await runWeatherEntryPipeline({
      signal,
      risk: (await ds.getRepository('WeatherConfig').findOne({ where: {} }))!,
      globalConfig: { realTradingEnabled: false } as never,
      watchlistId: 1,
      connectionManager,
      reservationService: new ReservationService(ds),
      simulationService: new SimulationService(ds),
      marketService: new MarketService(ds),
      orderQueue,
      redisCmd: redis as never,
      ds,
      backendUrl: 'http://localhost:3000',
      serviceToken: 'dev-token',
    });

    expect(result).toBe('Weather-algo désactivé');
    expect(orderSpy.all()).toHaveLength(0);
  });
});
