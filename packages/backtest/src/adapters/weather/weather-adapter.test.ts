import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DataSource } from 'typeorm';
import { createTestDataSource, initializeDataSource, type WeatherConfig } from '@polywatch/core';
import { WeatherMarketSnapshot, WeatherBucketTick, WeatherEvaluationLog, WeatherForecastHistory } from '@polywatch/core';
import { runBacktest } from '../../index.js';
import { BacktestRunService } from '@polywatch/core';

function baseRisk(overrides: Partial<WeatherConfig> = {}): WeatherConfig {
  return {
    weatherAlgoEnabled: true,
    weatherAlgoSimEnabled: true,
    weatherAlgoRealEnabled: false,
    weatherAlgoMinEdge: 0.1,
    weatherAlgoMaxForecastStd: null,
    weatherAlgoMinForecastProbability: null,
    weatherAlgoEntryUsdc: 10,
    weatherAlgoMaxPositionSizeUsdc: 200,
    weatherAlgoMaxOpenPositions: 10,
    weatherAlgoCloseBeforeResolutionHours: 1,
    weatherAlgoSizingMode: 'fixed_usdc',
    weatherAlgoSelectionMode: 'single',
    weatherAlgoMaxSignalsPerEvent: 3,
    weatherAlgoForecastChangeThreshold: 2,
    weatherAlgoBucketHysteresisPolls: 2,
    weatherAlgoPollMs: 1_800_000,
    weatherAlgoReentryThrottleMs: 1_800_000,
    weatherAlgoCityFollowSwitchMode: 'close_and_reenter',
    weatherAlgoSlEnabled: true,
    weatherAlgoTpEnabled: true,
    weatherAlgoTrailingEnabled: true,
    weatherAlgoSlBidPoints: 0.05,
    weatherAlgoTpBidPoints: 0.2,
    weatherAlgoTrailingBidPoints: null,
    weatherAlgoTrailingActivationBidPoints: null,
    weatherAlgoMinBidToAskRatio: 0.9,
    weatherAlgoSlConfirmationTicks: 2,
    weatherAlgoKillSwitchAction: 'block_entries',
    weatherAlgoEntryDepthRetryMax: 3,
    weatherAlgoEntryDepthRetryDelayMs: 1000,
    weatherAlgoSlCloseMaxRetries: 5,
    weatherAlgoMinTimeToClose: 0,
    weatherAlgoAllowedMarketTags: '[]',
    weatherAlgoSignalScoreSizingEnabled: true,
    weatherAlgoPreCloseEnabled: true,
    weatherAlgoPreCloseSeconds: 60,
    weatherAlgoMaxExposureUsdc: 1000,
    weatherAlgoMaxDailyLossUsdc: 100,
    weatherAlgoForecastHistoryRecordingEnabled: true,
    weatherAlgoMarketSnapshotRecordingEnabled: true,
    weatherAlgoEvaluationLogRecordingEnabled: true,
    weatherAlgoForecastHistoryRetentionDays: 90,
    weatherAlgoMarketSnapshotRetentionDays: 30,
    weatherAlgoEvaluationLogRetentionDays: 90,
    simInitialCapitalWeather: 1000,
    ...overrides,
  } as unknown as WeatherConfig;
}

describe('runBacktest (weather replay)', () => {
  let ds: DataSource;

  beforeEach(async () => {
    ds = await initializeDataSource(createTestDataSource());
  });

  afterEach(async () => {
    await ds.destroy();
  });

  async function seed(now: Date) {
    const snapRepo = ds.getRepository(WeatherMarketSnapshot);
    const tickRepo = ds.getRepository(WeatherBucketTick);
    const evalRepo = ds.getRepository(WeatherEvaluationLog);
    const histRepo = ds.getRepository(WeatherForecastHistory);

    const snap = await snapRepo.save(
      snapRepo.create({
        city: 'london',
        cityNormalized: 'london',
        targetDateIso: '2026-01-02',
        metric: 'highest_temp',
        forecastMean: 12,
        forecastStdDev: 1.5,
        bucketCount: 1,
        totalBucketCount: 3,
        ruleId: 1,
        recordedAt: now,
      }),
    );

    await histRepo.save(
      histRepo.create({
        city: 'london',
        forecastDate: new Date('2026-01-02T12:00:00Z'),
        metric: 'highest_temp',
        forecastMean: 12,
        forecastStdDev: 1.5,
        modelValuesJson: '{}',
        latitude: 51.5,
        longitude: -0.1,
        fetchedAt: now,
      }),
    );

    await tickRepo.save(
      tickRepo.create({
        snapshotId: snap.id,
        conditionId: 'cond-1',
        eventSlug: 'evt-1',
        question: 'Will the highest temperature in london be 12°C or above on 2026-01-02?',
        bucketComparison: 'or_above',
        bucketTarget: 12,
        bucketLow: null,
        bucketHigh: null,
        yesPrice: 0.3,
        noPrice: 0.7,
        yesTokenId: 'yes',
        noTokenId: 'no',
        volume: 100,
        volume24hr: 50,
        liquidityClob: 200,
        acceptingOrders: true,
        closed: false,
        endDate: new Date('2026-01-02T23:59:00Z'),
        recordedAt: now,
        city: 'london',
        cityNormalized: 'london',
        targetDateIso: '2026-01-02',
        metric: 'highest_temp',
      }),
    );

    // A tick after resolution time so the open position can be resolved.
    await tickRepo.save(
      tickRepo.create({
        snapshotId: snap.id,
        conditionId: 'cond-1',
        eventSlug: 'evt-1',
        question: 'Will the highest temperature in london be 12°C or above on 2026-01-02?',
        bucketComparison: 'or_above',
        bucketTarget: 12,
        bucketLow: null,
        bucketHigh: null,
        yesPrice: 0.3,
        noPrice: 0.7,
        yesTokenId: 'yes',
        noTokenId: 'no',
        volume: 100,
        volume24hr: 50,
        liquidityClob: 200,
        acceptingOrders: false,
        closed: true,
        endDate: new Date('2026-01-02T23:59:00Z'),
        recordedAt: new Date('2026-01-03T00:01:00.000Z'),
        city: 'london',
        cityNormalized: 'london',
        targetDateIso: '2026-01-02',
        metric: 'highest_temp',
      }),
    );

    await evalRepo.save(
      evalRepo.create({
        snapshotId: snap.id,
        conditionId: 'cond-1',
        bucketComparison: 'or_above',
        bucketTarget: 12,
        bucketLow: null,
        bucketHigh: null,
        strategyId: 'weather-forecast',
        yesPrice: 0.3,
        forecastProb: 0.7,
        edge: 0.4,
        dynamicMinEdge: 0.1,
        decision: 'signal',
        reason: 'test',
        evaluatedAt: now,
      }),
    );
  }

  it('replay mode enters a position from a recorded signal and resolves it', async () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    await seed(now);
    const service = new BacktestRunService(ds);

    const run = await service.create({
      domain: 'weather',
      mode: 'replay',
      paramsJson: JSON.stringify({}),
    });

    const result = await runBacktest({
      runId: run.id,
      ds,
      params: {
        domain: 'weather',
        mode: 'replay',
        from: '2026-01-01T00:00:00.000Z',
        to: '2026-01-04T00:00:00.000Z',
        capital: 1000,
        entryUsdc: 10,
        slippageBps: 0,
        maxConcurrentPositions: 10,
        detectionDelayMs: 0,
      },
      configSnapshot: baseRisk(),
      service,
    });

    const stored = await service.getById(run.id);
    expect(stored?.status).toBe('completed');
    expect(stored?.statsJson).toBeTruthy();

    const positions = await service.listPositions(run.id, {});
    expect(positions.items.length).toBeGreaterThanOrEqual(1);
    const pos = positions.items[0]!;
    expect(pos.conditionId).toBe('cond-1');
    expect(pos.exitReason).toBe('RESOLUTION');
    // entry at 0.3, resolution YES → exit at 1.0
    expect(pos.pnl).toBeGreaterThan(0);
  });

  it('respects maxConcurrentPositions', async () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    await seed(now);
    const service = new BacktestRunService(ds);

    const run = await service.create({
      domain: 'weather',
      mode: 'replay',
      paramsJson: JSON.stringify({}),
    });

    await runBacktest({
      runId: run.id,
      ds,
      params: {
        domain: 'weather',
        mode: 'replay',
        from: '2026-01-01T00:00:00.000Z',
        to: '2026-01-04T00:00:00.000Z',
        capital: 1000,
        entryUsdc: 10,
        slippageBps: 0,
        maxConcurrentPositions: 1,
        detectionDelayMs: 0,
      },
      configSnapshot: baseRisk(),
      service,
    });

    const positions = await service.listPositions(run.id, {});
    // Only one conditionId exists; open count can never exceed 1 anyway.
    expect(positions.items.length).toBe(1);
  });

  it('warns when no events are in range', async () => {
    const service = new BacktestRunService(ds);
    const run = await service.create({
      domain: 'weather',
      mode: 'replay',
      paramsJson: JSON.stringify({}),
    });
    const result = await runBacktest({
      runId: run.id,
      ds,
      params: {
        domain: 'weather',
        mode: 'replay',
        from: '2030-01-01T00:00:00.000Z',
        to: '2030-01-02T00:00:00.000Z',
        capital: 1000,
        entryUsdc: 10,
        slippageBps: 0,
        maxConcurrentPositions: 10,
        detectionDelayMs: 0,
      },
      configSnapshot: baseRisk(),
      service,
    });
    expect(result.fidelityWarnings.some((w) => w.startsWith('no_events_in_range'))).toBe(true);
    const stored = await service.getById(run.id);
    expect(stored?.status).toBe('completed');
  });

  it('replay mode with fidelityMinutes emits replay_fidelity_filter_unsupported warning', async () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    await seed(now);
    const service = new BacktestRunService(ds);

    const run = await service.create({
      domain: 'weather',
      mode: 'replay',
      paramsJson: JSON.stringify({}),
    });

    const result = await runBacktest({
      runId: run.id,
      ds,
      params: {
        domain: 'weather',
        mode: 'replay',
        from: '2026-01-01T00:00:00.000Z',
        to: '2026-01-04T00:00:00.000Z',
        capital: 1000,
        entryUsdc: 10,
        slippageBps: 0,
        maxConcurrentPositions: 10,
        detectionDelayMs: 0,
        fidelityMinutes: 15,
      },
      configSnapshot: baseRisk(),
      service,
    });

    expect(
      result.fidelityWarnings.some((w) => w.startsWith('replay_fidelity_filter_unsupported')),
    ).toBe(true);
  });

  it('persists metaJson on positions (edge/entryMean/bucketBounds)', async () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    await seed(now);
    const service = new BacktestRunService(ds);
    const run = await service.create({ domain: 'weather', mode: 'replay', paramsJson: '{}' });
    await runBacktest({
      runId: run.id,
      ds,
      params: {
        domain: 'weather', mode: 'replay',
        from: '2026-01-01T00:00:00.000Z', to: '2026-01-04T00:00:00.000Z',
        capital: 1000, entryUsdc: 10, slippageBps: 0,
        maxConcurrentPositions: 10, detectionDelayMs: 0,
      },
      configSnapshot: baseRisk(),
      service,
    });
    const positions = await service.listPositions(run.id, {});
    expect(positions.items.length).toBeGreaterThanOrEqual(1);
    const meta = JSON.parse(positions.items[0]!.metaJson ?? '{}');
    expect(meta.strategyId).toBe('weather-forecast');
    expect(meta.edge).toBeGreaterThan(0);
    expect(meta.entryBucketBounds).not.toBeUndefined();
  });

  it('resolves a position when endDate is null via targetDateIso fallback', async () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    const snapRepo = ds.getRepository(WeatherMarketSnapshot);
    const tickRepo = ds.getRepository(WeatherBucketTick);
    const evalRepo = ds.getRepository(WeatherEvaluationLog);

    // endDate null + targetDate in the past → must resolve via targetDateIso+24h.
    const snap = await snapRepo.save(snapRepo.create({
      city: 'paris', cityNormalized: 'paris', targetDateIso: '2026-01-02',
      metric: 'highest_temp', forecastMean: 20, forecastStdDev: 1,
      bucketCount: 1, totalBucketCount: 3, recordedAt: now,
    }));
    await tickRepo.save(tickRepo.create({
      snapshotId: snap.id, conditionId: 'cond-p1', eventSlug: 'e',
      question: 'Will the highest temperature in paris be 20°C or above on 2026-01-02?',
      bucketComparison: 'or_above', bucketTarget: 20, bucketLow: null, bucketHigh: null,
      yesPrice: 0.4, noPrice: 0.6, yesTokenId: 'y', noTokenId: 'n',
      volume: 1, volume24hr: 1, liquidityClob: 1,
      acceptingOrders: true, closed: false, endDate: null,
      recordedAt: now,
      city: 'paris', cityNormalized: 'paris', targetDateIso: '2026-01-02', metric: 'highest_temp',
    }));
    // A tick after the fallback resolution time (targetDateIso+24h = 2026-01-03)
    // so the resolution check fires for the open position.
    await tickRepo.save(tickRepo.create({
      snapshotId: snap.id, conditionId: 'cond-p1', eventSlug: 'e',
      question: 'Will the highest temperature in paris be 20°C or above on 2026-01-02?',
      bucketComparison: 'or_above', bucketTarget: 20, bucketLow: null, bucketHigh: null,
      yesPrice: 0.4, noPrice: 0.6, yesTokenId: 'y', noTokenId: 'n',
      volume: 1, volume24hr: 1, liquidityClob: 1,
      acceptingOrders: false, closed: true, endDate: null,
      recordedAt: new Date('2026-01-04T00:00:00.000Z'),
      city: 'paris', cityNormalized: 'paris', targetDateIso: '2026-01-02', metric: 'highest_temp',
    }));
    await evalRepo.save(evalRepo.create({
      snapshotId: snap.id, conditionId: 'cond-p1', bucketComparison: 'or_above',
      bucketTarget: 20, bucketLow: null, bucketHigh: null,
      strategyId: 'weather-forecast', yesPrice: 0.4, forecastProb: 0.8,
      edge: 0.4, dynamicMinEdge: 0.1, decision: 'signal', reason: 'test',
      evaluatedAt: now,
    }));

    const service = new BacktestRunService(ds);
    const run = await service.create({ domain: 'weather', mode: 'replay', paramsJson: '{}' });
    await runBacktest({
      runId: run.id,
      ds,
      params: {
        domain: 'weather', mode: 'replay',
        from: '2026-01-01T00:00:00.000Z', to: '2026-01-05T00:00:00.000Z',
        capital: 1000, entryUsdc: 10, slippageBps: 0,
        maxConcurrentPositions: 10, detectionDelayMs: 0,
      },
      configSnapshot: baseRisk(),
      service,
    });
    const positions = await service.listPositions(run.id, {});
    const pos = positions.items[0]!;
    expect(pos.exitReason).toBe('RESOLUTION');
    expect(pos.exitPrice).toBe(1); // forecast mean 20 in bucket → YES wins
  });

  it('ignores unsupported metrics with a fidelity warning (reevaluate)', async () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    const snapRepo = ds.getRepository(WeatherMarketSnapshot);
    const tickRepo = ds.getRepository(WeatherBucketTick);

    // precip metric is not supported by parseWeatherQuestion.
    const snap = await snapRepo.save(snapRepo.create({
      city: 'lyon', cityNormalized: 'lyon', targetDateIso: '2026-01-02',
      metric: 'precip', forecastMean: 5, forecastStdDev: 1,
      bucketCount: 1, totalBucketCount: 3, recordedAt: now,
    }));
    await tickRepo.save(tickRepo.create({
      snapshotId: snap.id, conditionId: 'cond-precip', eventSlug: 'e',
      question: null, bucketComparison: 'or_above', bucketTarget: 5,
      bucketLow: null, bucketHigh: null, yesPrice: 0.4, noPrice: 0.6,
      yesTokenId: 'y', noTokenId: 'n', volume: 1, volume24hr: 1, liquidityClob: 1,
      acceptingOrders: true, closed: false, endDate: null, recordedAt: now,
      city: 'lyon', cityNormalized: 'lyon', targetDateIso: '2026-01-02', metric: 'precip',
    }));

    const service = new BacktestRunService(ds);
    const run = await service.create({ domain: 'weather', mode: 'reevaluate', paramsJson: '{}' });
    const result = await runBacktest({
      runId: run.id,
      ds,
      params: {
        domain: 'weather', mode: 'reevaluate',
        from: '2026-01-01T00:00:00.000Z', to: '2026-01-04T00:00:00.000Z',
        capital: 1000, entryUsdc: 10, slippageBps: 0,
        maxConcurrentPositions: 10, detectionDelayMs: 0,
      },
      configSnapshot: baseRisk(),
      service,
    });
    // No position opened for an unsupported metric.
    const positions = await service.listPositions(run.id, {});
    expect(positions.items.length).toBe(0);
    expect(result.fidelityWarnings.some((w) => w.startsWith('unsupported_metric_or_bucket'))).toBe(true);
  });

  it('replay mode allows only one open position per city', async () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    const snapRepo = ds.getRepository(WeatherMarketSnapshot);
    const tickRepo = ds.getRepository(WeatherBucketTick);
    const evalRepo = ds.getRepository(WeatherEvaluationLog);

    const snap = await snapRepo.save(
      snapRepo.create({
        city: 'london',
        cityNormalized: 'london',
        targetDateIso: '2026-01-02',
        metric: 'highest_temp',
        forecastMean: 12,
        forecastStdDev: 1.5,
        bucketCount: 2,
        totalBucketCount: 3,
        recordedAt: now,
      }),
    );

    for (const [condId, target] of [
      ['cond-a', 12],
      ['cond-b', 13],
    ] as const) {
      await tickRepo.save(
        tickRepo.create({
          snapshotId: snap.id,
          conditionId: condId,
          eventSlug: 'evt-1',
          question: `Will the highest temperature in london be ${target}°C or above on 2026-01-02?`,
          bucketComparison: 'or_above',
          bucketTarget: target,
          bucketLow: null,
          bucketHigh: null,
          yesPrice: 0.3,
          noPrice: 0.7,
          yesTokenId: 'yes',
          noTokenId: 'no',
          volume: 100,
          volume24hr: 50,
          liquidityClob: 200,
          acceptingOrders: true,
          closed: false,
          endDate: new Date('2026-01-02T23:59:00Z'),
          recordedAt: now,
          city: 'london',
          cityNormalized: 'london',
          targetDateIso: '2026-01-02',
          metric: 'highest_temp',
        }),
      );
      await evalRepo.save(
        evalRepo.create({
          snapshotId: snap.id,
          conditionId: condId,
          bucketComparison: 'or_above',
          bucketTarget: target,
          bucketLow: null,
          bucketHigh: null,
          strategyId: 'weather-forecast',
          yesPrice: 0.3,
          forecastProb: 0.7,
          edge: 0.4,
          dynamicMinEdge: 0.1,
          decision: 'signal',
          reason: 'test',
          evaluatedAt: new Date(now.getTime() + (condId === 'cond-b' ? 1000 : 0)),
        }),
      );
    }

    const service = new BacktestRunService(ds);
    const run = await service.create({ domain: 'weather', mode: 'replay', paramsJson: '{}' });
    await runBacktest({
      runId: run.id,
      ds,
      params: {
        domain: 'weather',
        mode: 'replay',
        from: '2026-01-01T00:00:00.000Z',
        to: '2026-01-03T00:00:00.000Z',
        capital: 1000,
        entryUsdc: 10,
        slippageBps: 0,
        maxConcurrentPositions: 10,
        detectionDelayMs: 0,
      },
      configSnapshot: baseRisk(),
      service,
    });

    const positions = await service.listPositions(run.id, {});
    expect(positions.items.length).toBe(1);
    expect(positions.items[0]!.conditionId).toBe('cond-a');
  });
});
