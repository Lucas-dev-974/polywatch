import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DataSource } from 'typeorm';
import { createTestDataSource, initializeDataSource, type WeatherConfig } from '@polywatch/core';
import {
  WeatherMarketSnapshot,
  WeatherBucketTick,
  WeatherEvaluationLog,
  WeatherForecastHistory,
  BacktestRunService,
} from '@polywatch/core';
import { runBacktest, BACKTEST_ENGINE_VERSION } from '../../index.js';

/**
 * Golden replay: rejoue un scénario figé et fige les stats agrégées.
 *
 * Le seed est déterministe (dates, prix, signaux codés en dur) pour que le
 * moteur produise exactement le même set de positions à chaque exécution.
 * Toute régression de PnL / winRate / maxDrawdown / byExitReason qui modifie
 * la sémantique de replay sera détectée par un mismatch de snapshot.
 *
 * Si un fix change intentionnellement la sémantique, régénérer le snapshot :
 *   vitest run -u packages/backtest/src/adapters/weather/golden-replay.test.ts
 */
function baseRisk(): WeatherConfig {
  return {
    weatherAlgoEnabled: true,
    weatherAlgoSimEnabled: true,
    weatherAlgoRealEnabled: false,
    weatherAlgoMinEdge: 0.1,
    weatherAlgoEntryUsdc: 10,
    weatherAlgoMaxPositionSizeUsdc: 200,
    weatherAlgoMaxOpenPositions: 10,
    weatherAlgoSizingMode: 'fixed_usdc',
    weatherAlgoSelectionMode: 'single',
    weatherAlgoMaxSignalsPerEvent: 3,
    weatherAlgoPollMs: 1_800_000,
    weatherAlgoMinBidToAskRatio: 0.9,
    weatherAlgoAllowedMarketTags: '[]',
    weatherAlgoMaxExposureUsdc: 1000,
    weatherAlgoMaxDailyLossUsdc: 100,
    simInitialCapitalWeather: 1000,
  } as unknown as WeatherConfig;
}

describe('golden replay (regression canary)', () => {
  let ds: DataSource;

  beforeEach(async () => {
    ds = await initializeDataSource(createTestDataSource());
  });

  afterEach(async () => {
    await ds.destroy();
  });

  async function seed(): Promise<void> {
    const now = new Date('2026-03-01T00:00:00.000Z');
    const snapRepo = ds.getRepository(WeatherMarketSnapshot);
    const tickRepo = ds.getRepository(WeatherBucketTick);
    const evalRepo = ds.getRepository(WeatherEvaluationLog);
    const histRepo = ds.getRepository(WeatherForecastHistory);

    const snap = await snapRepo.save(
      snapRepo.create({
        city: 'madrid',
        cityNormalized: 'madrid',
        targetDateIso: '2026-03-02',
        metric: 'highest_temp',
        forecastMean: 18,
        forecastStdDev: 1,
        bucketCount: 1,
        totalBucketCount: 3,
        recordedAt: now,
      }),
    );

    await histRepo.save(
      histRepo.create({
        city: 'madrid',
        forecastDate: new Date('2026-03-02T12:00:00Z'),
        metric: 'highest_temp',
        forecastMean: 18,
        forecastStdDev: 1,
        modelValuesJson: '{}',
        latitude: 40.4,
        longitude: -3.7,
        fetchedAt: now,
      }),
    );

    // Entry tick (yesPrice 0.5), then a resolution tick (yesPrice 0.99, closed).
    const tickBase = {
      snapshotId: snap.id,
      conditionId: 'cond-golden',
      eventSlug: 'evt-golden',
      question: 'Will the highest temperature in madrid be 18°C or above on 2026-03-02?',
      bucketComparison: 'or_above',
      bucketTarget: 18,
      bucketLow: null,
      bucketHigh: null,
      yesTokenId: 'yes',
      noTokenId: 'no',
      volume: 100,
      volume24hr: 50,
      liquidityClob: 200,
      acceptingOrders: true,
      closed: false,
      endDate: new Date('2026-03-02T23:59:00Z'),
      city: 'madrid',
      cityNormalized: 'madrid',
      targetDateIso: '2026-03-02',
      metric: 'highest_temp',
    };
    await tickRepo.save(
      tickRepo.create({
        ...tickBase,
        yesPrice: 0.5,
        noPrice: 0.5,
        recordedAt: now,
      }),
    );
    await tickRepo.save(
      tickRepo.create({
        ...tickBase,
        yesPrice: 0.99,
        noPrice: 0.01,
        acceptingOrders: false,
        closed: true,
        recordedAt: new Date('2026-03-03T00:01:00.000Z'),
      }),
    );

    await evalRepo.save(
      evalRepo.create({
        snapshotId: snap.id,
        conditionId: 'cond-golden',
        bucketComparison: 'or_above',
        bucketTarget: 18,
        bucketLow: null,
        bucketHigh: null,
        strategyId: 'weather-forecast',
        yesPrice: 0.5,
        forecastProb: 0.7,
        edge: 0.2,
        dynamicMinEdge: 0.1,
        decision: 'signal',
        reason: 'golden',
        evaluatedAt: now,
      }),
    );
  }

  it('produces a stable stats signature', async () => {
    await seed();
    const service = new BacktestRunService(ds);
    const run = await service.create({
      domain: 'weather',
      mode: 'replay',
      paramsJson: '{}',
      engineVersion: BACKTEST_ENGINE_VERSION,
    });
    await runBacktest({
      runId: run.id,
      ds,
      params: {
        domain: 'weather',
        mode: 'replay',
        from: '2026-03-01T00:00:00.000Z',
        to: '2026-03-04T00:00:00.000Z',
        capital: 1000,
        entryUsdc: 10,
        slippageBps: 0,
        maxConcurrentPositions: 10,
      },
      configSnapshot: baseRisk(),
      service,
    });

    const stored = await service.getById(run.id);
    expect(stored?.status).toBe('completed');
    const stats = JSON.parse(stored?.statsJson ?? '{}');
    // Snapshot fige la signature : PnL, winRate, drawdown, exit reasons.
    // Toute régression sémantique du moteur changera ces valeurs.
    expect({
      totalPnl: stats.totalPnl,
      winRate: stats.winRate,
      maxDrawdown: stats.maxDrawdown,
      totalTrades: stats.totalTrades,
      byExitReason: stats.byExitReason,
      engineVersion: stored?.engineVersion,
    }).toMatchSnapshot();
  });
});
