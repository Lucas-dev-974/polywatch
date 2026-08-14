import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { WeatherConfig, CopiedPosition } from '@polywatch/core';

// --- Mocks for @polywatch/core helpers used by the exit evaluator ----------
const mocks = vi.hoisted(() => {
  return {
    shouldCloseBeforeResolution: vi.fn(() => false),
    shouldCloseForForecastDrift: vi.fn(() => false),
    shouldCloseForBucketExit: vi.fn(() => false),
    shouldEmitBucketExit: vi.fn(() => false),
    resolveCityFollowSwitchMode: vi.fn<(raw: string | null | undefined) => 'close_and_reenter' | 'hold'>(),
    setWeatherReentryThrottle: vi.fn(async () => {}),
    incrementWeatherBucketHysteresis: vi.fn(async () => 1),
    resetWeatherBucketHysteresis: vi.fn(async () => {}),
    buildCloseOrderSignal: vi.fn(() => ({ id: 'close-signal-1' })),
    resolveEnabledWeatherStrategies: vi.fn(() => ['weather-forecast']),
    WEATHER_FORECAST_STRATEGY_ID: 'weather-forecast',
    WEATHER_HIGHEST_YES_STRATEGY_ID: 'weather-highest-yes',
    getStrategyParams: vi.fn(() => ({
      minEdge: null,
      maxForecastStd: null,
      minForecastProbability: null,
      closeBeforeResolutionHours: null,
      entryUsdc: null,
      maxPositionSizeUsdc: null,
      entryDepthRetryMax: null,
      entryDepthRetryDelayMs: null,
      maxOpenPositions: null,
      maxExposureUsdc: null,
      maxDailyLossUsdc: null,
      killSwitchAction: null,
      forecastChangeThreshold: null,
      cityFollowSwitchMode: null,
      bucketHysteresisPolls: null,
      reentryThrottleMs: null,
    })),
    isWeatherMetric: vi.fn((v: unknown) => v === 'highest_temp' || v === 'lowest_temp'),
  };
});

vi.mock('@polywatch/core', () => ({
  CopiedPosition: class {},
  shouldCloseBeforeResolution: mocks.shouldCloseBeforeResolution,
  shouldCloseForForecastDrift: mocks.shouldCloseForForecastDrift,
  shouldCloseForBucketExit: mocks.shouldCloseForBucketExit,
  shouldEmitBucketExit: mocks.shouldEmitBucketExit,
  resolveCityFollowSwitchMode: mocks.resolveCityFollowSwitchMode,
  setWeatherReentryThrottle: mocks.setWeatherReentryThrottle,
  incrementWeatherBucketHysteresis: mocks.incrementWeatherBucketHysteresis,
  resetWeatherBucketHysteresis: mocks.resetWeatherBucketHysteresis,
  buildCloseOrderSignal: mocks.buildCloseOrderSignal,
  resolveEnabledWeatherStrategies: mocks.resolveEnabledWeatherStrategies,
  WEATHER_FORECAST_STRATEGY_ID: mocks.WEATHER_FORECAST_STRATEGY_ID,
  WEATHER_HIGHEST_YES_STRATEGY_ID: mocks.WEATHER_HIGHEST_YES_STRATEGY_ID,
  getStrategyParams: mocks.getStrategyParams,
  isWeatherMetric: mocks.isWeatherMetric,
}));

import { WeatherExitEvaluator } from './weather-exit-evaluator.js';

function baseRisk(overrides: Partial<WeatherConfig> = {}): WeatherConfig {
  return {
    weatherAlgoEnabled: true,
    weatherAlgoCloseBeforeResolutionHours: 1,
    weatherAlgoForecastChangeThreshold: 2,
    weatherAlgoBucketHysteresisPolls: 2,
    weatherAlgoCityFollowSwitchMode: 'close_and_reenter',
    weatherAlgoReentryThrottleMs: 1_800_000,
    ...overrides,
  } as unknown as WeatherConfig;
}

function basePos(overrides: Partial<CopiedPosition> = {}): CopiedPosition {
  return {
    id: 1,
    watchlistId: 1,
    status: 'open',
    reason: 'WEATHER_OPEN',
    conditionId: 'cond-1',
    assetId: 'asset-1',
    quantity: 10,
    mode: 'sim',
    entryPrice: 0.5,
    executableBidVwap: 0.4,
    closingAttemptSeq: 0,
    ...overrides,
  } as unknown as CopiedPosition;
}

function buildEvaluator(overrides: {
  positions?: CopiedPosition[];
  snapshot?: { city: string; targetDate: Date; metric: string; entryForecastMean: number; entryBucketComparison: string | null; entryBucketBounds: string | null; strategyId?: string | null } | null;
  forecastMean?: number;
  marketEndDate?: Date | null;
  bidVwap?: number;
  risk?: WeatherConfig;
} = {}) {
  const positions = overrides.positions ?? [basePos()];
  const snapshot = overrides.snapshot === undefined
    ? {
        city: 'Paris',
        targetDate: new Date('2026-08-02T12:00:00Z'),
        metric: 'highest_temp',
        entryForecastMean: 32,
        entryBucketComparison: 'exact' as const,
        entryBucketBounds: JSON.stringify({ target: 33 }),
      }
    : overrides.snapshot;

  const positionForecastService = {
    findByCopiedPositionId: vi.fn(async () => snapshot),
  };

  const forecastService = {
    getOrFetch: vi.fn(async () => ({
      forecastMean: overrides.forecastMean ?? 32,
      forecastStdDev: 1.5,
    })),
  };

  const marketService = {
    loadByConditionIds: vi.fn(async () => new Map([
      ['cond-1', { endDate: overrides.marketEndDate === undefined ? new Date(Date.now() + 48 * 3_600_000) : overrides.marketEndDate }],
    ])),
  };

  const connectionManager = {
    fetchExecutablePrices: vi.fn(async () => ({
      executableBidVwap: overrides.bidVwap === undefined ? 0.4 : overrides.bidVwap,
      executableAskVwap: 0.5,
    })),
  };

  const closeQueue = {
    enqueueUnique: vi.fn(async () => {}),
  };

  const redisCmd = {
    set: vi.fn(async () => 'OK'),
    get: vi.fn(async () => null),
    incr: vi.fn(async () => 1),
    del: vi.fn(async () => 1),
    expire: vi.fn(async () => 1),
  };

  const ds = {
    getRepository: vi.fn(() => ({
      find: async () => positions,
      findOne: async (opts: { where: { id: number } }) =>
        positions.find((p) => p.id === opts.where.id) ?? null,
    })),
  };

  const evaluator = new WeatherExitEvaluator({
    ds: ds as never,
    watchlistId: 1,
    risk: overrides.risk ?? baseRisk(),
    forecastService: forecastService as never,
    positionForecastService: positionForecastService as never,
    marketService: marketService as never,
    connectionManager: connectionManager as never,
    closeQueue: closeQueue as never,
    redisCmd: redisCmd as never,
  });

  return { evaluator, closeQueue, redisCmd, forecastService, positionForecastService, connectionManager, ds };
}

describe('WeatherExitEvaluator', () => {
  beforeEach(() => {
    // mockReset clears call history AND one-shot queues AND implementations;
    // we then re-establish the default return values for every mock.
    mocks.shouldCloseBeforeResolution.mockReset();
    mocks.shouldCloseForForecastDrift.mockReset();
    mocks.shouldCloseForBucketExit.mockReset();
    mocks.shouldEmitBucketExit.mockReset();
    mocks.resolveCityFollowSwitchMode.mockReset();
    mocks.incrementWeatherBucketHysteresis.mockReset();
    mocks.setWeatherReentryThrottle.mockReset();
    mocks.resetWeatherBucketHysteresis.mockReset();
    mocks.buildCloseOrderSignal.mockReset();

    mocks.shouldCloseBeforeResolution.mockReturnValue(false);
    mocks.shouldCloseForForecastDrift.mockReturnValue(false);
    mocks.shouldCloseForBucketExit.mockReturnValue(false);
    mocks.shouldEmitBucketExit.mockReturnValue(false);
    mocks.resolveCityFollowSwitchMode.mockReturnValue('close_and_reenter');
    mocks.incrementWeatherBucketHysteresis.mockResolvedValue(1);
    mocks.setWeatherReentryThrottle.mockResolvedValue(undefined);
    mocks.resetWeatherBucketHysteresis.mockResolvedValue(undefined);
    mocks.buildCloseOrderSignal.mockReturnValue({ id: 'close-signal-1' });
  });

  it('does nothing when there are no open positions with quantity > 0', async () => {
    const { evaluator, closeQueue } = buildEvaluator({ positions: [] });
    await evaluator.evaluateOpenPositions();
    expect(closeQueue.enqueueUnique).not.toHaveBeenCalled();
  });

  it('skips when no entry forecast snapshot is found', async () => {
    const { evaluator, closeQueue } = buildEvaluator({ snapshot: null });
    await evaluator.evaluateOpenPositions();
    expect(closeQueue.enqueueUnique).not.toHaveBeenCalled();
  });

  it('enqueues WEATHER_PRE_CLOSE when hoursToEnd <= closeBeforeHours', async () => {
    mocks.shouldCloseBeforeResolution.mockReturnValueOnce(true);
    const { evaluator, closeQueue, redisCmd } = buildEvaluator({
      marketEndDate: new Date(Date.now() + 30 * 60 * 1000), // 30 min < 1h
    });
    await evaluator.evaluateOpenPositions();
    expect(closeQueue.enqueueUnique).toHaveBeenCalledTimes(1);
    // preClose must NOT set the reentry throttle (only drift/bucketExit do)
    expect(mocks.setWeatherReentryThrottle).not.toHaveBeenCalled();
    expect(mocks.resetWeatherBucketHysteresis).not.toHaveBeenCalled();
  });

  it('enqueues WEATHER_FORECAST_CHANGE and sets throttle when forecast drift exceeds threshold', async () => {
    mocks.shouldCloseBeforeResolution.mockReturnValueOnce(false);
    mocks.shouldCloseForForecastDrift.mockReturnValueOnce(true);
    const { evaluator, closeQueue } = buildEvaluator({
      forecastMean: 35, // drifted from 32
    });
    await evaluator.evaluateOpenPositions();
    expect(closeQueue.enqueueUnique).toHaveBeenCalledTimes(1);
    expect(mocks.setWeatherReentryThrottle).toHaveBeenCalledTimes(1);
    expect(mocks.resetWeatherBucketHysteresis).toHaveBeenCalledTimes(1);
  });

  it('enqueues WEATHER_BUCKET_EXIT when bucket left, switchMode close_and_reenter, hysteresis reached', async () => {
    mocks.shouldCloseBeforeResolution.mockReturnValueOnce(false);
    mocks.shouldCloseForForecastDrift.mockReturnValueOnce(false);
    mocks.shouldCloseForBucketExit.mockReturnValueOnce(true);
    mocks.shouldEmitBucketExit.mockReturnValueOnce(true);
    mocks.incrementWeatherBucketHysteresis.mockResolvedValueOnce(2);
    const { evaluator, closeQueue } = buildEvaluator({
      forecastMean: 28, // left the bucket (target 33)
    });
    await evaluator.evaluateOpenPositions();
    expect(closeQueue.enqueueUnique).toHaveBeenCalledTimes(1);
    expect(mocks.setWeatherReentryThrottle).toHaveBeenCalledTimes(1);
    expect(mocks.resetWeatherBucketHysteresis).toHaveBeenCalledTimes(1);
  });

  it('does not enqueue when bucket left but switchMode is hold', async () => {
    mocks.shouldCloseBeforeResolution.mockReturnValueOnce(false);
    mocks.shouldCloseForForecastDrift.mockReturnValueOnce(false);
    mocks.shouldCloseForBucketExit.mockReturnValueOnce(true);
    // hold mode: shouldEmitBucketExit returns false because switchMode gate
    mocks.shouldEmitBucketExit.mockReturnValueOnce(false);
    mocks.resolveCityFollowSwitchMode.mockReturnValueOnce('hold');
    const { evaluator, closeQueue } = buildEvaluator({
      risk: baseRisk({ weatherAlgoCityFollowSwitchMode: 'hold' }),
      forecastMean: 28,
    });
    await evaluator.evaluateOpenPositions();
    expect(closeQueue.enqueueUnique).not.toHaveBeenCalled();
  });

  it('does not enqueue when bucket left but hysteresis not yet reached', async () => {
    mocks.shouldCloseBeforeResolution.mockReturnValueOnce(false);
    mocks.shouldCloseForForecastDrift.mockReturnValueOnce(false);
    mocks.shouldCloseForBucketExit.mockReturnValueOnce(true);
    mocks.shouldEmitBucketExit.mockReturnValueOnce(false);
    mocks.incrementWeatherBucketHysteresis.mockResolvedValueOnce(1); // < hysteresisPolls (2)
    const { evaluator, closeQueue } = buildEvaluator({
      forecastMean: 28,
    });
    await evaluator.evaluateOpenPositions();
    expect(closeQueue.enqueueUnique).not.toHaveBeenCalled();
    // hysteresis counter must still be incremented
    expect(mocks.incrementWeatherBucketHysteresis).toHaveBeenCalledTimes(1);
  });

  it('resets hysteresis when bucket is not left', async () => {
    mocks.shouldCloseBeforeResolution.mockReturnValueOnce(false);
    mocks.shouldCloseForForecastDrift.mockReturnValueOnce(false);
    mocks.shouldCloseForBucketExit.mockReturnValueOnce(false);
    const { evaluator, closeQueue } = buildEvaluator({
      forecastMean: 33, // still in bucket
    });
    await evaluator.evaluateOpenPositions();
    expect(closeQueue.enqueueUnique).not.toHaveBeenCalled();
    expect(mocks.resetWeatherBucketHysteresis).toHaveBeenCalledTimes(1);
  });

  it('defers close (no enqueue) when bidVwap is 0', async () => {
    mocks.shouldCloseBeforeResolution.mockReturnValueOnce(true);
    const { evaluator, closeQueue } = buildEvaluator({
      marketEndDate: new Date(Date.now() + 30 * 60 * 1000),
      bidVwap: 0,
    });
    await evaluator.evaluateOpenPositions();
    expect(closeQueue.enqueueUnique).not.toHaveBeenCalled();
  });

  it('does not enqueue when position status is no longer open at evaluation time', async () => {
    mocks.shouldCloseBeforeResolution.mockReturnValueOnce(true);
    // The mock ds.find() ignores the `where: { status: 'open' }` filter and
    // returns the position as-is; evaluatePosition then short-circuits on the
    // `if (pos.status !== 'open') return;` guard before any exit logic runs.
    const closedPos = basePos({ status: 'closing' });
    const { evaluator, closeQueue } = buildEvaluator({
      positions: [closedPos],
      marketEndDate: new Date(Date.now() + 30 * 60 * 1000),
    });
    await evaluator.evaluateOpenPositions();
    expect(closeQueue.enqueueUnique).not.toHaveBeenCalled();
  });

  it('does not run exit checks when forecast is unavailable (preClose false)', async () => {
    mocks.shouldCloseBeforeResolution.mockReturnValueOnce(false);
    const { evaluator, closeQueue, forecastService } = buildEvaluator();
    // Override forecastService to return null
    (forecastService.getOrFetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    await evaluator.evaluateOpenPositions();
    expect(closeQueue.enqueueUnique).not.toHaveBeenCalled();
  });

  it('highest-yes: skips drift and bucket-exit, never fetches forecast, no close', async () => {
    mocks.shouldCloseBeforeResolution.mockReturnValueOnce(false);
    const { evaluator, closeQueue, forecastService } = buildEvaluator({
      snapshot: {
        city: 'Paris',
        targetDate: new Date('2026-08-02T12:00:00Z'),
        metric: 'highest_temp',
        entryForecastMean: 0,
        entryBucketComparison: 'exact',
        entryBucketBounds: JSON.stringify({ target: 33 }),
        strategyId: 'weather-highest-yes',
      },
    });
    await evaluator.evaluateOpenPositions();
    // No drift / bucket-exit close for highest-yes.
    expect(closeQueue.enqueueUnique).not.toHaveBeenCalled();
    // The forecast must not be fetched (no forecast dependency).
    expect(forecastService.getOrFetch).not.toHaveBeenCalled();
    // Drift / bucket-exit helpers must not be consulted.
    expect(mocks.shouldCloseForForecastDrift).not.toHaveBeenCalled();
    expect(mocks.shouldCloseForBucketExit).not.toHaveBeenCalled();
  });

  it('highest-yes: still enqueues WEATHER_PRE_CLOSE when closeBeforeResolutionHours reached', async () => {
    mocks.shouldCloseBeforeResolution.mockReturnValueOnce(true);
    const { evaluator, closeQueue } = buildEvaluator({
      snapshot: {
        city: 'Paris',
        targetDate: new Date('2026-08-02T12:00:00Z'),
        metric: 'highest_temp',
        entryForecastMean: 0,
        entryBucketComparison: 'exact',
        entryBucketBounds: JSON.stringify({ target: 33 }),
        strategyId: 'weather-highest-yes',
      },
      marketEndDate: new Date(Date.now() + 30 * 60 * 1000),
    });
    await evaluator.evaluateOpenPositions();
    expect(closeQueue.enqueueUnique).toHaveBeenCalledTimes(1);
  });
});