import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { WeatherConfig, GlobalConfig } from '@polywatch/core';

// --- Mocks for @polywatch/core helpers used by the entry pipeline ----------
// vi.hoisted ensures the mock factories are defined before the hoisted
// vi.mock calls reference them. Synchronous factory (no importOriginal) to
// avoid loading the real core module's heavy side effects in unit tests.
const mocks = vi.hoisted(() => {
  return {
    hasAlgoEntryCooldown: vi.fn(async () => false),
    hasWeatherReentryThrottle: vi.fn(async () => false),
    resolveWeatherEntryExitParams: vi.fn(() => ({
      trailingBidPoints: null,
      trailingActivationBidPoints: null,
      slBidPoints: null,
      tpBidPoints: null,
    })),
    hashAlgoLogicalKey: vi.fn((p: unknown) => `logical:${JSON.stringify(p)}`),
    hashAlgoOrderSignalId: vi.fn((p: unknown) => `orderSignal:${JSON.stringify(p)}`),
    computeEntryTargetQuantity: vi.fn(() => 100),
    getWeatherMaxPositionSizeUsdc: vi.fn(() => 1000),
    resolveEntryBalances: vi.fn(async () => ({ cash: 1000, capitalForRatio: 1000 })),
    applyEntryMosGate: vi.fn<any>(async () => ({ ok: true, quantity: 100, askVwap: 0.5, bumped: false })),
    fetchEntryAskLiquidityWithRetries: vi.fn<any>(async () => ({ ok: true, attempts: 1 })),
    getWeatherEntryDepthRetryMax: vi.fn(() => 3),
    getWeatherEntryDepthRetryDelayMs: vi.fn(() => 100),
    enqueueEntrySignal: vi.fn(async () => ({ enqueued: true })),
    resolveEntryEnqueueBlocked: vi.fn(async () => null),
    resumeEntryFromReservation: vi.fn(async () => null),
    resolveEntryMinOrderSharesDetailed: vi.fn(async () => ({ minShares: 1, bump: false })),
    effectiveEntryMos: vi.fn(() => 1),
    fetchAvailableRealCash: vi.fn(async () => undefined),
    ExecutionService: vi.fn().mockImplementation(() => ({
      hasBuyForPosition: async () => false,
      hasInFlightBuy: async () => false,
    })),
  };
});

// Synchronous mock factory: provide only the runtime values the pipeline imports.
// Types are erased at runtime so they don't need to be present here.
vi.mock('@polywatch/core', () => ({
  hasAlgoEntryCooldown: mocks.hasAlgoEntryCooldown,
  hasWeatherReentryThrottle: mocks.hasWeatherReentryThrottle,
  resolveWeatherEntryExitParams: mocks.resolveWeatherEntryExitParams,
  hashAlgoLogicalKey: mocks.hashAlgoLogicalKey,
  hashAlgoOrderSignalId: mocks.hashAlgoOrderSignalId,
  computeEntryTargetQuantity: mocks.computeEntryTargetQuantity,
  getWeatherMaxPositionSizeUsdc: mocks.getWeatherMaxPositionSizeUsdc,
  resolveEntryBalances: mocks.resolveEntryBalances,
  applyEntryMosGate: mocks.applyEntryMosGate,
  fetchEntryAskLiquidityWithRetries: mocks.fetchEntryAskLiquidityWithRetries,
  getWeatherEntryDepthRetryMax: mocks.getWeatherEntryDepthRetryMax,
  getWeatherEntryDepthRetryDelayMs: mocks.getWeatherEntryDepthRetryDelayMs,
  enqueueEntrySignal: mocks.enqueueEntrySignal,
  resolveEntryEnqueueBlocked: mocks.resolveEntryEnqueueBlocked,
  resumeEntryFromReservation: mocks.resumeEntryFromReservation,
  resolveEntryMinOrderSharesDetailed: mocks.resolveEntryMinOrderSharesDetailed,
  effectiveEntryMos: mocks.effectiveEntryMos,
  MIN_ORDER_SHARES: 1,
  ExecutionService: mocks.ExecutionService,
  // Stub forecast services used by persistEntryForecastSnapshot fallback.
  WeatherForecastService: vi.fn().mockImplementation(() => ({
    getCached: async () => null,
  })),
  WeatherPositionForecastService: vi.fn().mockImplementation(() => ({
    saveIfAbsent: async () => {},
  })),
}));

vi.mock('../real-cash.js', () => ({
  fetchAvailableRealCash: mocks.fetchAvailableRealCash,
}));

vi.mock('../config.js', () => ({
  resolvedClobApi: 'https://clob.test',
}));

import { runWeatherEntryPipeline } from './weather-entry-pipeline.js';
import type { WeatherSignal } from '../strategy/strategy.js';

function baseSignal(overrides: Partial<WeatherSignal> = {}): WeatherSignal {
  return {
    conditionId: 'cond-1',
    assetId: 'asset-1',
    outcome: 'YES',
    side: 'BUY',
    confidence: 0.5,
    reasons: [],
    strategyId: 'weather-forecast',
    eventSlug: 'paris-aug-2',
    city: 'Paris',
    metric: 'highest_temp',
    targetDate: new Date('2026-08-02T12:00:00Z'),
    forecastMean: 32,
    forecastStdDev: 1.5,
    forecastProbability: 0.6,
    marketPrice: 0.1,
    edge: 0.5,
    entryBucketComparison: 'exact',
    entryBucketBounds: { target: 33 },
    ...overrides,
  };
}

function baseRisk(overrides: Partial<WeatherConfig> = {}): WeatherConfig {
  return {
    weatherAlgoEnabled: true,
    weatherAlgoSimEnabled: true,
    weatherAlgoRealEnabled: false,
    weatherAlgoMinEdge: 0.1,
    weatherAlgoMaxForecastStd: null,
    weatherAlgoEntryUsdc: 10,
    weatherAlgoCloseBeforeResolutionHours: 1,
    weatherAlgoSelectionMode: 'single',
    weatherAlgoMaxSignalsPerEvent: 3,
    weatherAlgoPollMs: 60_000,
    weatherAlgoForecastChangeThreshold: 2,
    weatherAlgoBucketHysteresisPolls: 2,
    weatherAlgoReentryThrottleMs: 1_800_000,
    weatherAlgoCityFollowSwitchMode: 'close_and_reenter',
    ...overrides,
  } as unknown as WeatherConfig;
}

function baseGlobalConfig(overrides: Partial<GlobalConfig> = {}): GlobalConfig {
  return { realTradingEnabled: false, ...overrides } as unknown as GlobalConfig;
}

function buildParams(overrides: Partial<Parameters<typeof runWeatherEntryPipeline>[0]> = {}) {
  const marketService = {
    ensureTradableMarket: vi.fn(async () => ({
      conditionId: 'cond-1',
      endDate: new Date(Date.now() + 48 * 3_600_000).toISOString(),
      tokenIdYes: 'yes-token',
    })),
    loadByConditionIds: vi.fn(async () => new Map()),
    ...overrides.marketService,
  };

  const connectionManager = {
    fetchExecutablePrices: vi.fn(async () => ({
      executableAskVwap: 0.5,
      executableBidVwap: 0.4,
    })),
    ...overrides.connectionManager,
  };

  const reservationService = {
    findActiveAlgoReservation: vi.fn(async () => null),
    reserve: vi.fn(async () => ({ reservationId: 1, copiedPositionId: 1 })),
    updateOrderSignalId: vi.fn(async () => {}),
    release: vi.fn(async () => {}),
    ...overrides.reservationService,
  };

  const simulationService = {
    getSimBalance: vi.fn(async () => ({ cash: 1000 })),
    ...overrides.simulationService,
  };

  const orderQueue = {
    hasDedupeMarker: vi.fn(async () => false),
    enqueueUnique: vi.fn(async () => true),
    ...overrides.orderQueue,
  };

  const redisCmd = { exists: vi.fn(async () => 0) };

  const ds = {
    getRepository: vi.fn(() => ({
      findOne: async () => null,
      save: async (e: unknown) => e,
      create: (e: unknown) => e,
    })),
    ...overrides.ds,
  };

  return {
    signal: baseSignal(),
    risk: baseRisk(),
    globalConfig: baseGlobalConfig(),
    watchlistId: 1,
    connectionManager: connectionManager as never,
    reservationService: reservationService as never,
    simulationService: simulationService as never,
    marketService: marketService as never,
    orderQueue: orderQueue as never,
    redisCmd: redisCmd as never,
    ds: ds as never,
    backendUrl: 'http://backend',
    serviceToken: 'token',
    ...overrides,
  } as Parameters<typeof runWeatherEntryPipeline>[0];
}

describe('runWeatherEntryPipeline skip-reasons', () => {
  beforeEach(() => {
    // Reset all shared mocks and re-establish default implementations so a
    // mockReturnValueOnce/mockImplementationOnce left over from a previous
    // test cannot leak into the next one.
    vi.resetAllMocks();
    mocks.hasAlgoEntryCooldown.mockResolvedValue(false);
    mocks.hasWeatherReentryThrottle.mockResolvedValue(false);
    mocks.resolveWeatherEntryExitParams.mockReturnValue({
      trailingBidPoints: null,
      trailingActivationBidPoints: null,
      slBidPoints: null,
      tpBidPoints: null,
    });
    mocks.hashAlgoLogicalKey.mockImplementation((p: unknown) => `logical:${JSON.stringify(p)}`);
    mocks.hashAlgoOrderSignalId.mockImplementation((p: unknown) => `orderSignal:${JSON.stringify(p)}`);
    mocks.computeEntryTargetQuantity.mockReturnValue(100);
    mocks.getWeatherMaxPositionSizeUsdc.mockReturnValue(1000);
    mocks.resolveEntryBalances.mockResolvedValue({ cash: 1000, capitalForRatio: 1000 });
    mocks.applyEntryMosGate.mockResolvedValue({ ok: true, quantity: 100, askVwap: 0.5, bumped: false });
    mocks.fetchEntryAskLiquidityWithRetries.mockResolvedValue({ ok: true, attempts: 1 });
    mocks.getWeatherEntryDepthRetryMax.mockReturnValue(3);
    mocks.getWeatherEntryDepthRetryDelayMs.mockReturnValue(100);
    mocks.enqueueEntrySignal.mockResolvedValue({ enqueued: true });
    mocks.resolveEntryEnqueueBlocked.mockResolvedValue(null);
    mocks.resumeEntryFromReservation.mockResolvedValue(null);
    mocks.resolveEntryMinOrderSharesDetailed.mockResolvedValue({ minShares: 1, bump: false });
    mocks.effectiveEntryMos.mockReturnValue(1);
    mocks.fetchAvailableRealCash.mockResolvedValue(undefined);
    mocks.ExecutionService.mockImplementation(() => ({
      hasBuyForPosition: async () => false,
      hasInFlightBuy: async () => false,
    }));
  });

  it('returns "Weather-algo désactivé" when risk.weatherAlgoEnabled is false', async () => {
    const params = buildParams({ risk: baseRisk({ weatherAlgoEnabled: false }) });
    const result = await runWeatherEntryPipeline(params);
    expect(result).toBe('Weather-algo désactivé');
  });

  it('returns "Marché introuvable" when ensureTradableMarket returns null', async () => {
    const params = buildParams({
      marketService: {
        ensureTradableMarket: vi.fn(async () => null),
        loadByConditionIds: vi.fn(async () => new Map()),
      } as never,
    });
    const result = await runWeatherEntryPipeline(params);
    expect(result).toBe('Marché introuvable');
  });

  it('returns "Marché se clôture trop tôt" when endDate is within minHoursToClose', async () => {
    const params = buildParams({
      marketService: {
        ensureTradableMarket: vi.fn(async () => ({
          conditionId: 'cond-1',
          endDate: new Date(Date.now() + 30 * 60 * 1000).toISOString(), // 30 min < 1h
          tokenIdYes: 'yes-token',
        })),
        loadByConditionIds: vi.fn(async () => new Map()),
      } as never,
    });
    const result = await runWeatherEntryPipeline(params);
    expect(result).toBe('Marché se clôture trop tôt');
  });

  it('returns "Pas de liquidité" when rough VWAP is 0', async () => {
    const params = buildParams({
      connectionManager: {
        fetchExecutablePrices: vi.fn(async () => ({
          executableAskVwap: 0,
          executableBidVwap: 0,
        })),
      } as never,
    });
    const result = await runWeatherEntryPipeline(params);
    expect(result).toBe('Pas de liquidité');
  });

  it('returns "Aucun mode exécutable" when sim mode hits cooldown (reason logged, not returned)', async () => {
    // The pipeline aggregates per-mode results; a skip reason is logged but the
    // top-level return value is the aggregate "no mode executable" string.
    mocks.hasAlgoEntryCooldown.mockResolvedValueOnce(true);
    const params = buildParams();
    const result = await runWeatherEntryPipeline(params);
    expect(result).toBe('Aucun mode exécutable');
  });

  it('returns "Aucun mode exécutable" when sim mode hits city throttle', async () => {
    mocks.hasAlgoEntryCooldown.mockResolvedValueOnce(false);
    mocks.hasWeatherReentryThrottle.mockResolvedValueOnce(true);
    const params = buildParams();
    const result = await runWeatherEntryPipeline(params);
    expect(result).toBe('Aucun mode exécutable');
  });

  it('returns "Aucun mode exécutable" when estimated target qty < MIN_ORDER_SHARES', async () => {
    mocks.hasAlgoEntryCooldown.mockResolvedValueOnce(false);
    mocks.hasWeatherReentryThrottle.mockResolvedValueOnce(false);
    mocks.computeEntryTargetQuantity.mockReturnValueOnce(0);
    const params = buildParams();
    const result = await runWeatherEntryPipeline(params);
    expect(result).toBe('Aucun mode exécutable');
  });

  it('returns "Aucun mode exécutable" when MOS gate fails', async () => {
    mocks.hasAlgoEntryCooldown.mockResolvedValueOnce(false);
    mocks.hasWeatherReentryThrottle.mockResolvedValueOnce(false);
    mocks.applyEntryMosGate.mockResolvedValueOnce({
      ok: false,
      quantity: 0,
      askVwap: 0.5,
      bumped: false,
      skipReason: 'MOS insuffisant',
    });
    const params = buildParams();
    const result = await runWeatherEntryPipeline(params);
    expect(result).toBe('Aucun mode exécutable');
  });

  it('returns "Aucun mode exécutable" when depth retry fails', async () => {
    mocks.hasAlgoEntryCooldown.mockResolvedValueOnce(false);
    mocks.hasWeatherReentryThrottle.mockResolvedValueOnce(false);
    mocks.fetchEntryAskLiquidityWithRetries.mockResolvedValueOnce({
      ok: false,
      attempts: 3,
      skipReason: 'Profondeur insuffisante',
    });
    const params = buildParams();
    const result = await runWeatherEntryPipeline(params);
    expect(result).toBe('Aucun mode exécutable');
  });

  it('returns null when sim mode enqueues successfully despite real mode cash unavailability', async () => {
    // Enable real mode + global real trading so runMode(real) reaches resolveEntryBalances.
    // sim mode enqueues first (success), real mode throws real_cash_unavailable.
    mocks.hasAlgoEntryCooldown.mockResolvedValueOnce(false);
    mocks.hasWeatherReentryThrottle.mockResolvedValueOnce(false);
    mocks.computeEntryTargetQuantity.mockReturnValueOnce(100);
    mocks.applyEntryMosGate.mockResolvedValueOnce({ ok: true, quantity: 100, askVwap: 0.5, bumped: false });
    mocks.fetchEntryAskLiquidityWithRetries.mockResolvedValueOnce({ ok: true, attempts: 1 });
    mocks.enqueueEntrySignal.mockResolvedValueOnce({ enqueued: true });
    mocks.resolveEntryEnqueueBlocked.mockResolvedValueOnce(null);
    // real mode: balances throw real_cash_unavailable
    mocks.resolveEntryBalances.mockImplementationOnce(async () => {
      throw new Error('real_cash_unavailable');
    });
    const params = buildParams({
      risk: baseRisk({ weatherAlgoSimEnabled: true, weatherAlgoRealEnabled: true }),
      globalConfig: baseGlobalConfig({ realTradingEnabled: true }),
    });
    // sim enqueued → pipeline returns null (success) overall
    const result = await runWeatherEntryPipeline(params);
    expect(result).toBeNull();
  });

  it('returns "Aucun mode exécutable" when real mode only and balances throw real_cash_unavailable', async () => {
    mocks.hasAlgoEntryCooldown.mockResolvedValueOnce(false);
    mocks.hasWeatherReentryThrottle.mockResolvedValueOnce(false);
    mocks.resolveEntryBalances.mockImplementationOnce(async () => {
      throw new Error('real_cash_unavailable');
    });
    const params = buildParams({
      risk: baseRisk({ weatherAlgoSimEnabled: false, weatherAlgoRealEnabled: true }),
      globalConfig: baseGlobalConfig({ realTradingEnabled: true }),
    });
    const result = await runWeatherEntryPipeline(params);
    expect(result).toBe('Aucun mode exécutable');
  });

  it('returns null (success) when sim mode enqueues successfully', async () => {
    mocks.hasAlgoEntryCooldown.mockResolvedValueOnce(false);
    mocks.hasWeatherReentryThrottle.mockResolvedValueOnce(false);
    mocks.computeEntryTargetQuantity.mockReturnValueOnce(100);
    mocks.applyEntryMosGate.mockResolvedValueOnce({ ok: true, quantity: 100, askVwap: 0.5, bumped: false });
    mocks.fetchEntryAskLiquidityWithRetries.mockResolvedValueOnce({ ok: true, attempts: 1 });
    mocks.enqueueEntrySignal.mockResolvedValueOnce({ enqueued: true });
    mocks.resolveEntryEnqueueBlocked.mockResolvedValueOnce(null);
    const params = buildParams();
    const result = await runWeatherEntryPipeline(params);
    expect(result).toBeNull();
  });
});