import type { DataSource } from 'typeorm';
import {
  BacktestRunService,
  DEFAULT_WEATHER_STRATEGY_PARAMS,
  type WeatherConfig,
} from '@polywatch/core';
import { loadWeatherEvents, countWeatherEvents, computeWeatherFidelityStats } from './adapters/weather/data-loader.js';
import { WeatherBacktestAdapter } from './adapters/weather/weather-adapter.js';
import { BacktestRunner, type RunResult } from './engine/runner.js';
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

export function applyConfigOverrides(
  config: WeatherConfig,
  overrides?: Record<string, unknown>,
): WeatherConfig {
  if (!overrides || Object.keys(overrides).length === 0) {
    return config;
  }

  // Les overrides sont limités aux clés météo et à des valeurs primitives
  // (les champs complexes sont stockés en JSON string côté WeatherConfig).
  // Cela évite un spread naïf qui corromprait silencieusement la config.
  const unknownKeys: string[] = [];
  for (const [key, value] of Object.entries(overrides)) {
    if (!key.startsWith('weatherAlgo')) {
      unknownKeys.push(key);
      continue;
    }
    const type = typeof value;
    if (
      value !== null &&
      type !== 'string' &&
      type !== 'number' &&
      type !== 'boolean'
    ) {
      throw new Error(
        `configOverrides: la valeur de '${key}' doit être primitive (string|number|boolean|null), reçu ${type}`,
      );
    }
  }
  if (unknownKeys.length > 0) {
    throw new Error(
      `configOverrides: clés inconnues (préfixe attendu 'weatherAlgo') : ${unknownKeys.join(', ')}`,
    );
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
  // Statistiques quantitatives de fidélité (§12.2) — best-effort, ne bloque
  // pas le run si la requête échoue (retourne des zéros).
  const fidelityStats = await computeWeatherFidelityStats(input.ds, params).catch(() => null);
  return runner.run({
    runId: input.runId,
    events: () => loadWeatherEvents(input.ds, params),
    estimateTotalEvents: () => countWeatherEvents(input.ds, params),
    adapterFactory: (ctx) => new WeatherBacktestAdapter(ctx, fidelityStats),
    initialCapital: params.capital,
    configSnapshot,
    slippageBps: params.slippageBps,
    maxConcurrentPositions,
    entryUsdc,
    strategyId: params.strategyId,
    fidelityMinutes: params.fidelityMinutes,
    service: input.service,
    getAbortReason: input.getAbortReason,
  });
}
