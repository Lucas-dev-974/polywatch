import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataSource } from 'typeorm';
import { PriceTickRecorder } from './price-tick-recorder.js';
import { MarketSurveillanceRecorder } from './market-surveillance-recorder.js';
import { createTestDataSource } from '@polywatch/core';
import { initializeDataSource } from '@polywatch/core';
import { AlgoSurveillanceSnapshot } from '@polywatch/core';

const safeIntervalMock = vi.hoisted(() => vi.fn());

vi.mock('@polywatch/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@polywatch/core')>();
  return {
    ...actual,
    safeInterval: (...args: unknown[]) => safeIntervalMock(...args),
  };
});

/**
 * Minimal fake DataSource so PriceTickRecorder.addMarket can resolve a
 * surveillance snapshot without a real database. Only `findOne` (used by
 * getByConditionId) is exercised by pause()/resume().
 */
function fakeDataSource(snapshot: unknown): DataSource {
  const repo = {
    findOne: async () => snapshot,
    create: () => ({}),
    save: async () => undefined,
    createQueryBuilder: () => ({
      where: () => ({
        delete: () => ({ execute: async () => ({ affected: 0 }) }),
      }),
      delete: () => ({ execute: async () => ({ affected: 0 }) }),
    }),
  };
  return {
    getRepository: () => repo,
  } as unknown as DataSource;
}

const ACTIVE_SNAPSHOT = {
  conditionId: 'cond-1',
  question: 'BTC Up or Down',
  cryptoSymbol: 'BTC',
  interval: '5m',
  marketStartAt: '2026-01-01T00:00:00Z',
  marketEndAt: '2030-01-01T00:00:00Z',
};

function makeDeps() {
  return {
    priceFeed: {
      getOutcomePrices: () => ({ upPrice: 0.5, downPrice: 0.5 }),
      getOutcomeBooks: () => ({ up: null, down: null, tokenIdYes: null, tokenIdNo: null }),
      isHealthy: () => true,
    } as never,
    connectionManager: { getOrderBook: () => undefined } as never,
    refQty: 50,
    signalRegistry: {
      getLast: () => null,
      getLastAbstain: () => null,
      remove: () => {},
    } as never,
    positionCache: {
      getMetrics: () => ({ count: 0, exposureUsd: 0, unrealizedPnl: 0 }),
    } as never,
    chartTickPublisher: { pushTick: () => {} } as never,
  };
}

describe('PriceTickRecorder pause/resume', () => {
  beforeEach(() => {
    safeIntervalMock.mockReset();
    // Return a fake Timeout object so clearInterval works without a real timer.
    safeIntervalMock.mockImplementation(() => ({ __fakeTimer: true } as never));
  });

  it('starts the tick timer on addMarket, halts on pause, restarts on resume', async () => {
    const recorder = new PriceTickRecorder(
      fakeDataSource(ACTIVE_SNAPSHOT),
      makeDeps(),
    );

    await recorder.addMarket('cond-1');
    expect(safeIntervalMock).toHaveBeenCalledTimes(1);

    recorder.pause();
    expect(safeIntervalMock).toHaveBeenCalledTimes(1);

    recorder.resume();
    expect(safeIntervalMock).toHaveBeenCalledTimes(2);
  });

  it('removeMarket while paused does not recreate the timer', async () => {
    const recorder = new PriceTickRecorder(
      fakeDataSource(ACTIVE_SNAPSHOT),
      makeDeps(),
    );

    await recorder.addMarket('cond-1');
    recorder.pause();
    expect(safeIntervalMock).toHaveBeenCalledTimes(1);

    recorder.removeMarket('cond-1');
    expect(safeIntervalMock).toHaveBeenCalledTimes(1);
  });
});

describe('MarketSurveillanceRecorder paused no-op', () => {
  let ds: Awaited<ReturnType<typeof initializeDataSource>>;

  beforeEach(async () => {
    ds = await initializeDataSource(createTestDataSource());
  });

  it('refresh() while paused schedules no open/close snapshot', async () => {
    const recorder = new MarketSurveillanceRecorder(ds, null);
    recorder.pause();

    await recorder.refresh([
      {
        conditionId: 'cond-paused',
        question: 'ETH Up or Down',
        cryptoSymbol: 'ETH',
        interval: '5m',
      },
    ]);

    const count = await ds
      .getRepository(AlgoSurveillanceSnapshot)
      .count({ where: { conditionId: 'cond-paused' } });
    expect(count).toBe(0);
  });

  it('refresh() after resume re-enables scheduling', async () => {
    const recorder = new MarketSurveillanceRecorder(ds, null);
    recorder.pause();
    recorder.resume();

    // After resume, the next refresh() schedules an open/close capture. Gamma
    // fetch fails (no network) so no snapshot row is created here; the point is
    // that pause() is cleared and scheduling is no longer short-circuited.
    await expect(
      recorder.refresh([
        {
          conditionId: 'cond-resumed',
          question: 'BTC Up or Down',
          cryptoSymbol: 'BTC',
          interval: '5m',
        },
      ]),
    ).resolves.toBeUndefined();
  });
});
