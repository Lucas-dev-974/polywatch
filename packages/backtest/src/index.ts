import type { DataSource } from 'typeorm';
import {
  BacktestRunService,
  DEFAULT_WEATHER_STRATEGY_PARAMS,
  type WeatherConfig,
} from '@polywatch/core';
import { loadWeatherEvents, countWeatherEvents } from './adapters/weather/data-loader.js';
import { WeatherBacktestAdapter } from './adapters/weather/weather-adapter.js';
import { BacktestRunner, type RunResult, type RunContext } from './engine/runner.js';
import {
  parseBacktestParams,
  backtestRunParamsSchema,
  type BacktestRunParams,
} from './params.js';

export { parseBacktestParams, backtestRunParamsSchema, type BacktestRunParams };
export { BACKTEST_ENGINE_VERSION } from './engine-version.js';

export interface RunBacktestInput {
  runId: number;
  ds: DataSource;
  params: BacktestRunParams | Record<string, unknown>;
  configSnapshot: WeatherConfig;
  service: BacktestRunService;
  getAbortReason?: () => 'cancelled' | 'timeout' | null;
}

function applyConfigOverrides(
  config: WeatherConfig,
  overrides?: Record<string, unknown>,
): WeatherConfig {
  if (!overrides || Object.keys(overrides).length === 0) {
    return config;
  }
  return { ...config, ...overrides } as WeatherConfig;
}

/**
 * Entry point of the backtest package. Loads weather events from the DB,
 * builds the weather adapter, and runs the event-driven replay.
 */
export async function runBacktest(input: RunBacktestInput): Promise<RunResult> {
  const params = parseBacktestParams(input.params);
  const configSnapshot = applyConfigOverrides(
    input.configSnapshot,
    params.configOverrides,
  );

  const entryUsdc = params.entryUsdc ?? DEFAULT_WEATHER_STRATEGY_PARAMS.entryUsdc;
  const maxConcurrentPositions =
    params.maxConcurrentPositions ?? DEFAULT_WEATHER_STRATEGY_PARAMS.maxOpenPositions;

  const runner = new BacktestRunner();
  return runner.run({
    runId: input.runId,
    events: () => loadWeatherEvents(input.ds, params),
    estimateTotalEvents: () => countWeatherEvents(input.ds, params),
    adapterFactory: (ctx) => new WeatherBacktestAdapter(ctx),
    initialCapital: params.capital,
    configSnapshot,
    slippageBps: params.slippageBps,
    maxConcurrentPositions,
    entryUsdc,
    detectionDelayMs: params.detectionDelayMs,
    mode: params.mode,
    strategyId: params.strategyId,
    backtestExecutionMode: params.backtestExecutionMode,
    fidelityMinutes: params.fidelityMinutes,
    service: input.service,
    getAbortReason: input.getAbortReason,
  });
}

/** Factory used by the backend route to create the weather adapter. */
export function createWeatherAdapter(ctx: RunContext): WeatherBacktestAdapter {
  return new WeatherBacktestAdapter(ctx);
}
