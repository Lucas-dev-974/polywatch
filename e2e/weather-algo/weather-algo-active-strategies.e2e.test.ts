import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataSource } from 'typeorm';
import {
  WeatherAutoTrackService,
  WeatherForecastService,
  WeatherForecastHistoryRecorder,
  WeatherMarketSnapshotRecorder,
  WeatherEvaluationRecorder,
  WeatherForecastCache,
  WeatherAutoTrackRule,
} from '@polywatch/core';
import {
  WeatherStrategyRegistry,
  WeatherForecastStrategy,
  WeatherForecastAlignedStrategy,
  WeatherHighestYesStrategy,
} from '../../packages/weather-algo/src/strategy/registry.js';
import { WeatherStrategyRunner } from '../../packages/weather-algo/src/strategy/strategy-runner.js';
import { WeatherAlgoRuntimeStatusPublisher } from '../../packages/weather-algo/src/runtime-status.js';
import { createTestDataSource } from './helpers/database.js';
import { MockRedis } from '../crypto-algo/helpers/redis-mock.js';
import { configureWeatherAlgoRisk } from './helpers/risk-config.js';

// Neutralise the MOS HTTP fetch by pointing the CLOB API to an inert URL.
vi.mock('../../packages/weather-algo/src/config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../packages/weather-algo/src/config.js')>();
  return {
    ...actual,
    resolvedClobApi: 'http://clob.test',
  };
});

// Neutralise the Gamma discovery HTTP fetch — the runner calls
// discoverWeatherMarkets / discoverResolvedWeatherMarkets on each cycle.
vi.mock('@polywatch/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@polywatch/core')>();
  return {
    ...actual,
    discoverWeatherMarkets: vi.fn(async () => ({
      temperatureMarkets: [],
      allWeatherMarkets: [],
      byCity: [],
    })),
    discoverResolvedWeatherMarkets: vi.fn(async () => ({
      resolvedTemperatureMarkets: [],
    })),
  };
});

const RUNTIME_STATUS_KEY = 'weather-algo:runtime-status';

describe('weather-algo activeStrategies e2e', () => {
  let ds: DataSource;
  let redis: MockRedis;

  beforeEach(async () => {
    ds = await createTestDataSource();
    redis = new MockRedis();
  });

  afterEach(async () => {
    await ds.destroy();
    redis.clear();
  });

  async function seedCityRule(city = 'Paris'): Promise<void> {
    const repo = ds.getRepository(WeatherAutoTrackRule);
    await repo.save(
      repo.create({
        city,
        metric: 'highest_temp',
        lookAheadDays: 1,
        mode: 'city_follow',
        enabled: true,
      }),
    );
  }

  async function seedForecast(city = 'Paris'): Promise<void> {
    const repo = ds.getRepository(WeatherForecastCache);
    const targetDate = new Date(Date.now() + 24 * 3_600_000);
    await repo.save(
      repo.create({
        city,
        forecastDate: targetDate,
        metric: 'highest_temp',
        forecastMean: 33,
        forecastStdDev: 1.5,
        modelValues: JSON.stringify({ gfs: 33, ecmwf: 32 }),
        latitude: 48.85,
        longitude: 2.35,
        expiresAt: new Date(Date.now() + 3_600_000),
      }),
    );
  }

  function buildRunner(risk: Parameters<WeatherStrategyRunner['setRiskConfig']>[0]) {
    const registrySim = new WeatherStrategyRegistry();
    const registryReal = new WeatherStrategyRegistry();
    for (const registry of [registrySim, registryReal]) {
      registry.register(new WeatherForecastStrategy());
      registry.register(new WeatherForecastAlignedStrategy());
      registry.register(new WeatherHighestYesStrategy());
    }

    const runner = new WeatherStrategyRunner({
      ds,
      autoTrackService: new WeatherAutoTrackService(ds),
      forecastService: new WeatherForecastService(ds),
      registrySim,
      registryReal,
      redisCmd: redis as never,
      onSignal: async () => false,
      pollMs: 60_000,
      runtimeStatus: new WeatherAlgoRuntimeStatusPublisher(redis as never),
      forecastHistoryRecorder: new WeatherForecastHistoryRecorder(ds),
      marketSnapshotRecorder: new WeatherMarketSnapshotRecorder(ds),
      evaluationRecorder: new WeatherEvaluationRecorder(ds),
    });
    runner.setRiskConfig(risk);
    return runner;
  }

  it('publishes activeStrategiesSim/Real to runtime-status after a cycle', async () => {
    await seedCityRule();
    await seedForecast();
    const risk = await configureWeatherAlgoRisk(ds, {
      weatherAlgoRealEnabled: true,
      simWeatherAlgoStrategies: JSON.stringify(['weather-forecast', 'weather-forecast-aligned']),
      realWeatherAlgoStrategies: JSON.stringify(['weather-forecast', 'weather-forecast-aligned']),
      weatherAlgoMarketSnapshotRecordingEnabled: true,
      weatherAlgoEvaluationLogRecordingEnabled: true,
    });

    const runner = buildRunner(risk);
    // Trigger a full evaluation cycle synchronously (bypasses the UTC-aligned timer).
    await (runner as unknown as { runEvaluationCycle: () => Promise<void> }).runEvaluationCycle();

    const raw = await redis.get(RUNTIME_STATUS_KEY);
    expect(raw).not.toBeNull();
    const status = JSON.parse(raw!) as {
      activeStrategiesSim: string[];
      activeStrategiesReal: string[];
    };
    expect(status.activeStrategiesSim).toEqual(['weather-forecast', 'weather-forecast-aligned']);
    expect(status.activeStrategiesReal).toEqual(['weather-forecast', 'weather-forecast-aligned']);
  });

  it('publishes only the enabled strategies (single strategy)', async () => {
    await seedCityRule();
    await seedForecast();
    const risk = await configureWeatherAlgoRisk(ds, {
      weatherAlgoRealEnabled: true,
      simWeatherAlgoStrategies: JSON.stringify(['weather-forecast']),
      realWeatherAlgoStrategies: JSON.stringify(['weather-forecast']),
    });

    const runner = buildRunner(risk);
    await (runner as unknown as { runEvaluationCycle: () => Promise<void> }).runEvaluationCycle();

    const raw = await redis.get(RUNTIME_STATUS_KEY);
    expect(raw).not.toBeNull();
    const status = JSON.parse(raw!) as {
      activeStrategiesSim: string[];
      activeStrategiesReal: string[];
    };
    expect(status.activeStrategiesSim).toEqual(['weather-forecast']);
    expect(status.activeStrategiesReal).toEqual(['weather-forecast']);
  });
});
