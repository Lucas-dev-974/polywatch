import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DataSource } from 'typeorm';
import { createTestDataSource, initializeDataSource, BacktestRunService } from '@polywatch/core';
import { BacktestRunner, type RunSpec } from './runner.js';
import type { BacktestEvent } from './events.js';
import type { BacktestDomainAdapter } from '../adapters/backtest-domain-adapter.js';
import type { WeatherConfig } from '@polywatch/core';

function emptyConfig(): WeatherConfig {
  return {} as WeatherConfig;
}

async function* streamOf(events: BacktestEvent[]): AsyncGenerator<BacktestEvent> {
  for (const e of events) yield e;
}

function makeSpec(
  events: BacktestEvent[],
  opts: {
    service: BacktestRunService;
    runId: number;
    getAbortReason?: () => 'cancelled' | 'timeout' | null;
  },
): RunSpec {
  return {
    runId: opts.runId,
    events: () => streamOf(events),
    estimateTotalEvents: async () => events.length,
    adapterFactory: () => ({
      async handle() {
        /* no-op adapter for abort/persistence tests */
      },
    }),
    initialCapital: 1000,
    configSnapshot: emptyConfig(),
    slippageBps: 0,
    maxConcurrentPositions: 10,
    entryUsdc: 10,
    strategyId: 'weather-forecast',
    strategyEnv: 'sim',
    service: opts.service,
    getAbortReason: opts.getAbortReason,
  };
}

const tickEvent = (at: string): Extract<BacktestEvent, { kind: 'book_tick' }> => ({
  kind: 'book_tick',
  at: new Date(at),
  data: {
    conditionId: 'c1',
    snapshotCity: 'paris',
    snapshotTargetDateIso: '2026-01-02',
    snapshotMetric: 'highest_temp',
    snapshotForecastMean: 20,
    yesPrice: 0.5,
    noPrice: 0.5,
    volume: 1,
    volume24hr: 1,
    liquidityClob: 1,
    acceptingOrders: true,
    closed: false,
    endDate: null,
    bucketComparison: 'or_above',
    bucketTarget: 20,
    bucketLow: null,
    bucketHigh: null,
    eventSlug: 'e',
    question: 'q',
    tokenIdYes: 'yes',
  },
});

describe('BacktestRunner', () => {
  let ds: DataSource;

  beforeEach(async () => {
    ds = await initializeDataSource(createTestDataSource());
  });

  afterEach(async () => {
    await ds.destroy();
  });

  async function newRun() {
    const service = new BacktestRunService(ds);
    const run = await service.create({ domain: 'weather', mode: 'reevaluate', paramsJson: '{}' });
    return { service, runId: run.id };
  }

  it('completes a run over an empty event stream', async () => {
    const { service, runId } = await newRun();
    const result = await new BacktestRunner().run(makeSpec([], { service, runId }));
    expect(result.runId).toBe(runId);
    expect(result.stats.totalTrades).toBe(0);
    const stored = await service.getById(runId);
    expect(stored?.status).toBe('completed');
  });

  it('completes and persists progress across several events', async () => {
    const { service, runId } = await newRun();
    const events = [
      tickEvent('2026-01-01T00:00:00.000Z'),
      tickEvent('2026-01-01T00:02:00.000Z'),
    ];
    const result = await new BacktestRunner().run(makeSpec(events, { service, runId }));
    expect(result.positionsCount).toBe(0);
    expect(result.equitySamplesCount).toBeGreaterThanOrEqual(1);
    const stored = await service.getById(runId);
    expect(stored?.status).toBe('completed');
    expect(stored?.progressPct).toBe(100);
  });

  it('marks the run cancelled when abort reason becomes cancelled mid-stream', async () => {
    const { service, runId } = await newRun();
    let aborted = false;
    let handled = 0;
    const adapter: BacktestDomainAdapter = {
      async handle() {
        handled++;
        if (handled === 1) aborted = true;
      },
    };
    const spec: RunSpec = {
      runId,
      events: () =>
        streamOf([
          tickEvent('2026-01-01T00:00:00.000Z'),
          tickEvent('2026-01-01T00:01:00.000Z'),
        ]),
      estimateTotalEvents: async () => 2,
      adapterFactory: () => adapter,
      initialCapital: 1000,
      configSnapshot: emptyConfig(),
      slippageBps: 0,
      maxConcurrentPositions: 10,
      entryUsdc: 10,
      strategyId: 'weather-forecast',
      strategyEnv: 'sim',
      service,
      getAbortReason: () => (aborted ? 'cancelled' : null),
    };
    const result = await new BacktestRunner().run(spec);
    expect(result).toBeTruthy();
    const stored = await service.getById(runId);
    expect(stored?.status).toBe('cancelled');
    // Cancel still persists equity samples (interval + final).
    expect((await service.listEquity(runId)).length).toBeGreaterThanOrEqual(1);
  });

  it('marks the run failed (timeout) when abort reason becomes timeout mid-stream', async () => {
    const { service, runId } = await newRun();
    let timedOut = false;
    let handled = 0;
    const adapter: BacktestDomainAdapter = {
      async handle() {
        handled++;
        if (handled === 1) timedOut = true;
      },
    };
    const spec: RunSpec = {
      runId,
      events: () =>
        streamOf([
          tickEvent('2026-01-01T00:00:00.000Z'),
          tickEvent('2026-01-01T00:01:00.000Z'),
        ]),
      estimateTotalEvents: async () => 2,
      adapterFactory: () => adapter,
      initialCapital: 1000,
      configSnapshot: emptyConfig(),
      slippageBps: 0,
      maxConcurrentPositions: 10,
      entryUsdc: 10,
      strategyId: 'weather-forecast',
      strategyEnv: 'sim',
      service,
      getAbortReason: () => (timedOut ? 'timeout' : null),
    };
    await new BacktestRunner().run(spec);
    const stored = await service.getById(runId);
    expect(stored?.status).toBe('failed');
    expect(stored?.error).toBe('timeout');
  });
});
