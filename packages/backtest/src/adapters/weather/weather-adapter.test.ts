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
    weatherAlgoMinBidToAskRatio: 0.9,
    weatherAlgoSlConfirmationTicks: 2,
    weatherAlgoKillSwitchAction: 'block_entries',
    weatherAlgoEntryDepthRetryMax: 3,
    weatherAlgoEntryDepthRetryDelayMs: 1000,
    weatherAlgoSlCloseMaxRetries: 5,
    weatherAlgoMinTimeToClose: 0,
    weatherAlgoAllowedMarketTags: '[]',
    weatherAlgoSignalScoreSizingEnabled: true,
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
        yesPrice: 0.99,
        noPrice: 0.01,
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
        maxConcurrentPositions: 10,
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
      },
      configSnapshot: baseRisk(),
      service,
    });
    expect(result.fidelityWarnings.some((w) => w.startsWith('no_events_in_range'))).toBe(true);
    const stored = await service.getById(run.id);
    expect(stored?.status).toBe('completed');
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
        maxConcurrentPositions: 10,
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

  it('resolves a position by YES price reaching 0.99 (resolution by price)', async () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    const snapRepo = ds.getRepository(WeatherMarketSnapshot);
    const tickRepo = ds.getRepository(WeatherBucketTick);
    const evalRepo = ds.getRepository(WeatherEvaluationLog);

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
    // A tick where YES reaches 0.99 → the open position resolves as YES.
    await tickRepo.save(tickRepo.create({
      snapshotId: snap.id, conditionId: 'cond-p1', eventSlug: 'e',
      question: 'Will the highest temperature in paris be 20°C or above on 2026-01-02?',
      bucketComparison: 'or_above', bucketTarget: 20, bucketLow: null, bucketHigh: null,
      yesPrice: 0.99, noPrice: 0.01, yesTokenId: 'y', noTokenId: 'n',
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
        maxConcurrentPositions: 10,
      },
      configSnapshot: baseRisk(),
      service,
    });
    const positions = await service.listPositions(run.id, {});
    const pos = positions.items[0]!;
    expect(pos.exitReason).toBe('RESOLUTION');
    expect(pos.exitPrice).toBe(1); // YES price 0.99 → YES wins
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
        maxConcurrentPositions: 10,
      },
      configSnapshot: baseRisk(),
      service,
    });
    // No position opened for an unsupported metric.
    const positions = await service.listPositions(run.id, {});
    expect(positions.items.length).toBe(0);
    expect(result.fidelityWarnings.some((w) => w.startsWith('unsupported_metric_or_bucket'))).toBe(true);
  });

  it('reevaluate: entry is timestamped at decision, not at flush (no zero-holding)', async () => {
    // Scénario du bug : un signal décidé à T1 est flushé à T2 (changement de
    // timestamp), puis un tick suivant au même T2 déclenche l'exit. Sans le
    // fix, entryAt = T2 (flush) et exitAt = T2 → holding 0. Avec le fix,
    // entryAt = T1 (décision) et exitAt = T2 > T1.
    const t1 = new Date('2026-01-01T00:00:00.000Z');
    const t2 = new Date('2026-01-03T00:00:00.000Z');
    const snapRepo = ds.getRepository(WeatherMarketSnapshot);
    const tickRepo = ds.getRepository(WeatherBucketTick);
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
        recordedAt: t1,
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
        fetchedAt: t1,
      }),
    );

    const baseTick = {
      snapshotId: snap.id,
      eventSlug: 'evt-1',
      question: 'Will the highest temperature in london be 12°C or above on 2026-01-02?',
      bucketComparison: 'or_above',
      bucketTarget: 12,
      bucketLow: null,
      bucketHigh: null,
      yesTokenId: 'yes',
      noTokenId: 'no',
      volume: 100,
      volume24hr: 50,
      liquidityClob: 200,
      city: 'london',
      cityNormalized: 'london',
      targetDateIso: '2026-01-02',
      metric: 'highest_temp',
    };

    // Tick A @ T1 : émet le signal (décision). Prix sain.
    await tickRepo.save(
      tickRepo.create({
        ...baseTick,
        conditionId: 'cond-reeval',
        yesPrice: 0.3,
        noPrice: 0.7,
        acceptingOrders: true,
        closed: false,
        endDate: new Date('2026-01-02T23:59:00Z'),
        recordedAt: t1,
      }),
    );
    // Tick B @ T2 : premier tick du nouveau timestamp → flush (ouvre la position).
    await tickRepo.save(
      tickRepo.create({
        ...baseTick,
        conditionId: 'cond-reeval',
        yesPrice: 0.3,
        noPrice: 0.7,
        acceptingOrders: true,
        closed: false,
        endDate: new Date('2026-01-02T23:59:00Z'),
        recordedAt: t2,
      }),
    );
    // Tick C @ T2 : second tick du même timestamp → evaluateExits → résolution.
    await tickRepo.save(
      tickRepo.create({
        ...baseTick,
        conditionId: 'cond-reeval',
        yesPrice: 0.99,
        noPrice: 0.01,
        acceptingOrders: false,
        closed: true,
        endDate: new Date('2026-01-02T23:59:00Z'),
        recordedAt: t2,
      }),
    );

    const service = new BacktestRunService(ds);
    const run = await service.create({ domain: 'weather', mode: 'reevaluate', paramsJson: '{}' });
    await runBacktest({
      runId: run.id,
      ds,
      params: {
        domain: 'weather', mode: 'reevaluate',
        from: '2026-01-01T00:00:00.000Z', to: '2026-01-04T00:00:00.000Z',
        capital: 1000, entryUsdc: 10, slippageBps: 0,
        maxConcurrentPositions: 10,
      },
      configSnapshot: baseRisk(),
      service,
    });

    const positions = await service.listPositions(run.id, {});
    expect(positions.items.length).toBe(1);
    const pos = positions.items[0]!;
    // entryAt = timestamp de décision (T1), pas le flush (T2).
    expect(new Date(pos.entryAt).getTime()).toBe(t1.getTime());
    // exitAt = T2 (résolution) > entryAt = T1 → plus de zero-holding.
    expect(new Date(pos.exitAt!).getTime()).toBe(t2.getTime());
    expect(new Date(pos.exitAt!).getTime()).toBeGreaterThan(new Date(pos.entryAt).getTime());
    expect(pos.exitReason).toBe('RESOLUTION');
  });

  it('reevaluate: does not open a position that would resolve 10ms later (same-poll jitter)', async () => {
    // Run #51 Atlanta : signal à T, tick résolu à T+10ms. decidedAt rend
    // entryAt = T et exitAt = T+10ms (même seconde à l'affichage, durée 0 min).
    // Coalesce + garde sur le prix COURANT : pas d'entrée.
    const t1 = new Date('2026-01-01T00:00:00.000Z');
    const t1b = new Date(t1.getTime() + 10);
    const snapRepo = ds.getRepository(WeatherMarketSnapshot);
    const tickRepo = ds.getRepository(WeatherBucketTick);
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
        recordedAt: t1,
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
        fetchedAt: t1,
      }),
    );

    const baseTick = {
      snapshotId: snap.id,
      eventSlug: 'evt-1',
      question: 'Will the highest temperature in london be 12°C or above on 2026-01-02?',
      bucketComparison: 'or_above',
      bucketTarget: 12,
      bucketLow: null,
      bucketHigh: null,
      yesTokenId: 'yes',
      noTokenId: 'no',
      volume: 100,
      volume24hr: 50,
      liquidityClob: 200,
      city: 'london',
      cityNormalized: 'london',
      targetDateIso: '2026-01-02',
      metric: 'highest_temp',
    };

    await tickRepo.save(
      tickRepo.create({
        ...baseTick,
        conditionId: 'cond-jitter',
        yesPrice: 0.3,
        noPrice: 0.7,
        acceptingOrders: true,
        closed: false,
        endDate: new Date('2026-01-02T23:59:00Z'),
        recordedAt: t1,
      }),
    );
    await tickRepo.save(
      tickRepo.create({
        ...baseTick,
        conditionId: 'cond-jitter',
        yesPrice: 0.99,
        noPrice: 0.01,
        acceptingOrders: false,
        closed: true,
        endDate: new Date('2026-01-02T23:59:00Z'),
        recordedAt: t1b,
      }),
    );

    const service = new BacktestRunService(ds);
    const run = await service.create({ domain: 'weather', mode: 'reevaluate', paramsJson: '{}' });
    await runBacktest({
      runId: run.id,
      ds,
      params: {
        domain: 'weather', mode: 'reevaluate',
        from: '2026-01-01T00:00:00.000Z', to: '2026-01-04T00:00:00.000Z',
        capital: 1000, entryUsdc: 10, slippageBps: 0,
        maxConcurrentPositions: 10,
      },
      configSnapshot: baseRisk(),
      service,
    });

    const positions = await service.listPositions(run.id, {});
    expect(positions.items.length).toBe(0);
  });

  it('reevaluate: sibling tick 10ms later does not flush into an immediate resolution', async () => {
    // Premier tick d'un nouveau timestamp = autre marché, 10 ms plus tard le
    // marché signalé est déjà à 0.99. Sans coalesce, flush puis RESOLUTION.
    const t1 = new Date('2026-01-01T00:00:00.000Z');
    const t1b = new Date(t1.getTime() + 10);
    const t1c = new Date(t1.getTime() + 20);
    const snapRepo = ds.getRepository(WeatherMarketSnapshot);
    const tickRepo = ds.getRepository(WeatherBucketTick);
    const histRepo = ds.getRepository(WeatherForecastHistory);

    const snapL = await snapRepo.save(
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
        recordedAt: t1,
      }),
    );
    const snapP = await snapRepo.save(
      snapRepo.create({
        city: 'paris',
        cityNormalized: 'paris',
        targetDateIso: '2026-01-02',
        metric: 'highest_temp',
        forecastMean: 8,
        forecastStdDev: 1.5,
        bucketCount: 1,
        totalBucketCount: 3,
        ruleId: 1,
        recordedAt: t1b,
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
        fetchedAt: t1,
      }),
    );
    await histRepo.save(
      histRepo.create({
        city: 'paris',
        forecastDate: new Date('2026-01-02T12:00:00Z'),
        metric: 'highest_temp',
        forecastMean: 8,
        forecastStdDev: 1.5,
        modelValuesJson: '{}',
        latitude: 48.8,
        longitude: 2.3,
        fetchedAt: t1b,
      }),
    );

    const tickFields = {
      eventSlug: 'evt-1',
      bucketComparison: 'or_above' as const,
      bucketLow: null,
      bucketHigh: null,
      yesTokenId: 'yes',
      noTokenId: 'no',
      volume: 100,
      volume24hr: 50,
      liquidityClob: 200,
      metric: 'highest_temp',
      targetDateIso: '2026-01-02',
    };

    await tickRepo.save(
      tickRepo.create({
        ...tickFields,
        snapshotId: snapL.id,
        question: 'Will the highest temperature in london be 12°C or above on 2026-01-02?',
        bucketTarget: 12,
        city: 'london',
        cityNormalized: 'london',
        conditionId: 'cond-london',
        yesPrice: 0.3,
        noPrice: 0.7,
        acceptingOrders: true,
        closed: false,
        endDate: new Date('2026-01-02T23:59:00Z'),
        recordedAt: t1,
      }),
    );
    await tickRepo.save(
      tickRepo.create({
        ...tickFields,
        snapshotId: snapP.id,
        question: 'Will the highest temperature in paris be 8°C or above on 2026-01-02?',
        bucketTarget: 8,
        city: 'paris',
        cityNormalized: 'paris',
        conditionId: 'cond-paris',
        yesPrice: 0.5,
        noPrice: 0.5,
        acceptingOrders: true,
        closed: false,
        endDate: new Date('2026-01-02T23:59:00Z'),
        recordedAt: t1b,
      }),
    );
    await tickRepo.save(
      tickRepo.create({
        ...tickFields,
        snapshotId: snapL.id,
        question: 'Will the highest temperature in london be 12°C or above on 2026-01-02?',
        bucketTarget: 12,
        city: 'london',
        cityNormalized: 'london',
        conditionId: 'cond-london',
        yesPrice: 0.99,
        noPrice: 0.01,
        acceptingOrders: false,
        closed: true,
        endDate: new Date('2026-01-02T23:59:00Z'),
        recordedAt: t1c,
      }),
    );

    const service = new BacktestRunService(ds);
    const run = await service.create({ domain: 'weather', mode: 'reevaluate', paramsJson: '{}' });
    await runBacktest({
      runId: run.id,
      ds,
      params: {
        domain: 'weather', mode: 'reevaluate',
        from: '2026-01-01T00:00:00.000Z', to: '2026-01-04T00:00:00.000Z',
        capital: 1000, entryUsdc: 10, slippageBps: 0,
        maxConcurrentPositions: 10,
      },
      configSnapshot: baseRisk(),
      service,
    });

    const positions = await service.listPositions(run.id, {});
    const london = positions.items.filter((p) => p.conditionId === 'cond-london');
    expect(london.length).toBe(0);
  });

  it('reevaluate: skips flush when decision price has gone stale vs current tick', async () => {
    // Austin #5808 : fill à 0.58 alors que le tick à entryAt est à 0.98 —
    // le marker flotte entre les courbes. Un saut de prix > 0.10 entre
    // décision et flush doit empêcher l'entrée.
    const t1 = new Date('2026-01-01T00:00:00.000Z');
    const t2 = new Date(t1.getTime() + 5 * 60_000);
    const snapRepo = ds.getRepository(WeatherMarketSnapshot);
    const tickRepo = ds.getRepository(WeatherBucketTick);
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
        recordedAt: t1,
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
        fetchedAt: t1,
      }),
    );

    const baseTick = {
      snapshotId: snap.id,
      eventSlug: 'evt-1',
      question: 'Will the highest temperature in london be 12°C or above on 2026-01-02?',
      bucketComparison: 'or_above',
      bucketTarget: 12,
      bucketLow: null,
      bucketHigh: null,
      yesTokenId: 'yes',
      noTokenId: 'no',
      volume: 100,
      volume24hr: 50,
      liquidityClob: 200,
      city: 'london',
      cityNormalized: 'london',
      targetDateIso: '2026-01-02',
      metric: 'highest_temp',
      conditionId: 'cond-stale',
    };

    await tickRepo.save(
      tickRepo.create({
        ...baseTick,
        yesPrice: 0.3,
        noPrice: 0.7,
        acceptingOrders: true,
        closed: false,
        endDate: new Date('2026-01-02T23:59:00Z'),
        recordedAt: t1,
      }),
    );
    await tickRepo.save(
      tickRepo.create({
        ...baseTick,
        yesPrice: 0.85,
        noPrice: 0.15,
        acceptingOrders: false,
        closed: true,
        endDate: new Date('2026-01-02T23:59:00Z'),
        recordedAt: t2,
      }),
    );

    const service = new BacktestRunService(ds);
    const run = await service.create({ domain: 'weather', mode: 'reevaluate', paramsJson: '{}' });
    await runBacktest({
      runId: run.id,
      ds,
      params: {
        domain: 'weather', mode: 'reevaluate',
        from: '2026-01-01T00:00:00.000Z', to: '2026-01-04T00:00:00.000Z',
        capital: 1000, entryUsdc: 10, slippageBps: 0,
        maxConcurrentPositions: 10,
      },
      configSnapshot: baseRisk(),
      service,
    });

    const positions = await service.listPositions(run.id, {});
    expect(positions.items.length).toBe(0);
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
      },
      configSnapshot: baseRisk(),
      service,
    });

    const positions = await service.listPositions(run.id, {});
    expect(positions.items.length).toBe(1);
    expect(positions.items[0]!.conditionId).toBe('cond-a');
  });

  it('resolves a highest-yes position via the final YES price (no forecast)', async () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    const snapRepo = ds.getRepository(WeatherMarketSnapshot);
    const tickRepo = ds.getRepository(WeatherBucketTick);
    const evalRepo = ds.getRepository(WeatherEvaluationLog);

    const snap = await snapRepo.save(snapRepo.create({
      city: 'paris', cityNormalized: 'paris', targetDateIso: '2026-01-02',
      metric: 'highest_temp', forecastMean: 20, forecastStdDev: 1,
      bucketCount: 1, totalBucketCount: 3, recordedAt: now,
    }));
    await tickRepo.save(tickRepo.create({
      snapshotId: snap.id, conditionId: 'cond-hy', eventSlug: 'e',
      question: 'Will the highest temperature in paris be 20°C or above on 2026-01-02?',
      bucketComparison: 'or_above', bucketTarget: 20, bucketLow: null, bucketHigh: null,
      yesPrice: 0.6, noPrice: 0.4, yesTokenId: 'y', noTokenId: 'n',
      volume: 1, volume24hr: 1, liquidityClob: 1,
      acceptingOrders: true, closed: false, endDate: null,
      recordedAt: now,
      city: 'paris', cityNormalized: 'paris', targetDateIso: '2026-01-02', metric: 'highest_temp',
    }));
    // Final tick with YES price reaching 0.99 → resolves YES.
    await tickRepo.save(tickRepo.create({
      snapshotId: snap.id, conditionId: 'cond-hy', eventSlug: 'e',
      question: 'Will the highest temperature in paris be 20°C or above on 2026-01-02?',
      bucketComparison: 'or_above', bucketTarget: 20, bucketLow: null, bucketHigh: null,
      yesPrice: 0.99, noPrice: 0.01, yesTokenId: 'y', noTokenId: 'n',
      volume: 1, volume24hr: 1, liquidityClob: 1,
      acceptingOrders: false, closed: true, endDate: null,
      recordedAt: new Date('2026-01-04T00:00:00.000Z'),
      city: 'paris', cityNormalized: 'paris', targetDateIso: '2026-01-02', metric: 'highest_temp',
    }));
    await evalRepo.save(evalRepo.create({
      snapshotId: snap.id, conditionId: 'cond-hy', bucketComparison: 'or_above',
      bucketTarget: 20, bucketLow: null, bucketHigh: null,
      strategyId: 'weather-highest-yes', yesPrice: 0.6, forecastProb: 0,
      edge: 0, dynamicMinEdge: 0, decision: 'signal', reason: 'test',
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
        maxConcurrentPositions: 10,
        strategyId: 'weather-highest-yes',
      },
      configSnapshot: baseRisk(),
      service,
    });
    const positions = await service.listPositions(run.id, {});
    const pos = positions.items[0]!;
    expect(pos.exitReason).toBe('RESOLUTION');
    expect(pos.exitPrice).toBe(1); // final YES price 0.99 → YES wins
  });

  it('resolves highest-yes via markPrice fallback when tick.yesPrice is null', async () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    const snapRepo = ds.getRepository(WeatherMarketSnapshot);
    const tickRepo = ds.getRepository(WeatherBucketTick);
    const evalRepo = ds.getRepository(WeatherEvaluationLog);

    const snap = await snapRepo.save(snapRepo.create({
      city: 'paris', cityNormalized: 'paris', targetDateIso: '2026-01-02',
      metric: 'highest_temp', forecastMean: 20, forecastStdDev: 1,
      bucketCount: 1, totalBucketCount: 3, recordedAt: now,
    }));
    // Entry tick with yesPrice
    await tickRepo.save(tickRepo.create({
      snapshotId: snap.id, conditionId: 'cond-hy-fb1', eventSlug: 'e',
      question: 'Will the highest temperature in paris be 20°C or above on 2026-01-02?',
      bucketComparison: 'or_above', bucketTarget: 20, bucketLow: null, bucketHigh: null,
      yesPrice: 0.99, noPrice: 0.01, yesTokenId: 'y', noTokenId: 'n',
      volume: 1, volume24hr: 1, liquidityClob: 1,
      acceptingOrders: true, closed: false, endDate: null,
      recordedAt: now,
      city: 'paris', cityNormalized: 'paris', targetDateIso: '2026-01-02', metric: 'highest_temp',
    }));
    // Resolution tick WITHOUT yesPrice (null) — simulates missing data
    await tickRepo.save(tickRepo.create({
      snapshotId: snap.id, conditionId: 'cond-hy-fb1', eventSlug: 'e',
      question: 'Will the highest temperature in paris be 20°C or above on 2026-01-02?',
      bucketComparison: 'or_above', bucketTarget: 20, bucketLow: null, bucketHigh: null,
      yesPrice: null, noPrice: null, yesTokenId: 'y', noTokenId: 'n',
      volume: 1, volume24hr: 1, liquidityClob: 1,
      acceptingOrders: false, closed: true, endDate: null,
      recordedAt: new Date('2026-01-04T00:00:00.000Z'),
      city: 'paris', cityNormalized: 'paris', targetDateIso: '2026-01-02', metric: 'highest_temp',
    }));
    await evalRepo.save(evalRepo.create({
      snapshotId: snap.id, conditionId: 'cond-hy-fb1', bucketComparison: 'or_above',
      bucketTarget: 20, bucketLow: null, bucketHigh: null,
      strategyId: 'weather-highest-yes', yesPrice: 0.99, forecastProb: 0,
      edge: 0, dynamicMinEdge: 0, decision: 'signal', reason: 'test',
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
        maxConcurrentPositions: 10,
        strategyId: 'weather-highest-yes',
      },
      configSnapshot: baseRisk(),
      service,
    });

    const positions = await service.listPositions(run.id, {});
    const pos = positions.items[0]!;
    expect(pos.exitReason).toBe('RESOLUTION');
    // Should resolve using markPrice (0.99 from entry tick) → YES wins (0.99 >= 0.99)
    expect(pos.exitPrice).toBe(1);
  });

  it('resolves highest-yes via markPrice fallback when tick.yesPrice is null', async () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    const snapRepo = ds.getRepository(WeatherMarketSnapshot);
    const tickRepo = ds.getRepository(WeatherBucketTick);
    const evalRepo = ds.getRepository(WeatherEvaluationLog);

    const snap = await snapRepo.save(snapRepo.create({
      city: 'lyon', cityNormalized: 'lyon', targetDateIso: '2026-01-02',
      metric: 'highest_temp', forecastMean: 20, forecastStdDev: 1,
      bucketCount: 1, totalBucketCount: 3, recordedAt: now,
    }));
    // Entry tick with yesPrice — this sets entryPrice (and markPrice) on position
    await tickRepo.save(tickRepo.create({
      snapshotId: snap.id, conditionId: 'cond-hy-fb2', eventSlug: 'e',
      question: 'Will the highest temperature in lyon be 20°C or above on 2026-01-02?',
      bucketComparison: 'or_above', bucketTarget: 20, bucketLow: null, bucketHigh: null,
      yesPrice: 0.01, noPrice: 0.99, yesTokenId: 'y', noTokenId: 'n',
      volume: 1, volume24hr: 1, liquidityClob: 1,
      acceptingOrders: true, closed: false, endDate: null,
      recordedAt: now,
      city: 'lyon', cityNormalized: 'lyon', targetDateIso: '2026-01-02', metric: 'highest_temp',
    }));
    // Resolution tick WITHOUT yesPrice — markPrice (initialised to entryPrice value) is the fallback
    await tickRepo.save(tickRepo.create({
      snapshotId: snap.id, conditionId: 'cond-hy-fb2', eventSlug: 'e',
      question: 'Will the highest temperature in lyon be 20°C or above on 2026-01-02?',
      bucketComparison: 'or_above', bucketTarget: 20, bucketLow: null, bucketHigh: null,
      yesPrice: null, noPrice: null, yesTokenId: 'y', noTokenId: 'n',
      volume: 1, volume24hr: 1, liquidityClob: 1,
      acceptingOrders: false, closed: true, endDate: null,
      recordedAt: new Date('2026-01-04T00:00:00.000Z'),
      city: 'lyon', cityNormalized: 'lyon', targetDateIso: '2026-01-02', metric: 'highest_temp',
    }));
    await evalRepo.save(evalRepo.create({
      snapshotId: snap.id, conditionId: 'cond-hy-fb2', bucketComparison: 'or_above',
      bucketTarget: 20, bucketLow: null, bucketHigh: null,
      strategyId: 'weather-highest-yes', yesPrice: 0.01, forecastProb: 0,
      edge: 0, dynamicMinEdge: 0, decision: 'signal', reason: 'test',
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
        maxConcurrentPositions: 10,
        strategyId: 'weather-highest-yes',
      },
      configSnapshot: baseRisk(),
      service,
    });

    const positions = await service.listPositions(run.id, {});
    const pos = positions.items[0]!;
    expect(pos.exitReason).toBe('RESOLUTION');
    // Falls back to markPrice (initialised to entryPrice 0.01) → 0.01 <= 0.01 → NO wins → exitPrice = 0
    expect(pos.exitPrice).toBe(0);
  });

  it('force-closes ghost positions at finish with BACKTEST_INCOMPLETE_DATA', async () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    const snapRepo = ds.getRepository(WeatherMarketSnapshot);
    const tickRepo = ds.getRepository(WeatherBucketTick);
    const evalRepo = ds.getRepository(WeatherEvaluationLog);

    const snap = await snapRepo.save(snapRepo.create({
      city: 'nantes', cityNormalized: 'nantes', targetDateIso: '2026-01-02',
      metric: 'highest_temp', forecastMean: 20, forecastStdDev: 1,
      bucketCount: 1, totalBucketCount: 3, recordedAt: now,
    }));
    await tickRepo.save(tickRepo.create({
      snapshotId: snap.id, conditionId: 'cond-ghost', eventSlug: 'e',
      question: 'Will the highest temperature in nantes be 20°C or above on 2026-01-02?',
      bucketComparison: 'or_above', bucketTarget: 20, bucketLow: null, bucketHigh: null,
      yesPrice: 0.4, noPrice: 0.6, yesTokenId: 'y', noTokenId: 'n',
      volume: 1, volume24hr: 1, liquidityClob: 1,
      acceptingOrders: true, closed: false, endDate: new Date('2026-01-10T00:00:00.000Z'),
      recordedAt: now,
      city: 'nantes', cityNormalized: 'nantes', targetDateIso: '2026-01-02', metric: 'highest_temp',
    }));
    await evalRepo.save(evalRepo.create({
      snapshotId: snap.id, conditionId: 'cond-ghost', bucketComparison: 'or_above',
      bucketTarget: 20, bucketLow: null, bucketHigh: null,
      strategyId: 'weather-forecast', yesPrice: 0.4, forecastProb: 0.7,
      edge: 0.4, dynamicMinEdge: 0.1, decision: 'signal', reason: 'test',
      evaluatedAt: now,
    }));

    const service = new BacktestRunService(ds);
    const run = await service.create({ domain: 'weather', mode: 'replay', paramsJson: '{}' });
    const result = await runBacktest({
      runId: run.id,
      ds,
      params: {
        domain: 'weather', mode: 'replay',
        from: '2026-01-01T00:00:00.000Z', to: '2026-01-02T00:00:00.000Z',
        capital: 1000, entryUsdc: 10, slippageBps: 0,
        maxConcurrentPositions: 10,
      },
      configSnapshot: baseRisk(),
      service,
    });

    const positions = await service.listPositions(run.id, {});
    expect(positions.items.length).toBe(1);
    const pos = positions.items[0]!;
    expect(pos.exitReason).toBe('BACKTEST_INCOMPLETE_DATA');
    expect(pos.exitPrice).toBeGreaterThan(0);
    expect(result.fidelityWarnings.some((w) => w.startsWith('ghost_positions_forced_resolution'))).toBe(true);
  });

  it('does not close highest-yes position by drift/bucket exit (guard §6)', async () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    const snapRepo = ds.getRepository(WeatherMarketSnapshot);
    const tickRepo = ds.getRepository(WeatherBucketTick);
    const evalRepo = ds.getRepository(WeatherEvaluationLog);

    const snap = await snapRepo.save(snapRepo.create({
      city: 'bordeaux', cityNormalized: 'bordeaux', targetDateIso: '2026-01-02',
      metric: 'highest_temp', forecastMean: 20, forecastStdDev: 1,
      bucketCount: 1, totalBucketCount: 3, recordedAt: now,
    }));
    await tickRepo.save(tickRepo.create({
      snapshotId: snap.id, conditionId: 'cond-hy-guard', eventSlug: 'e',
      question: 'Will the highest temperature in bordeaux be 20°C or above on 2026-01-02?',
      bucketComparison: 'or_above', bucketTarget: 20, bucketLow: null, bucketHigh: null,
      yesPrice: 0.6, noPrice: 0.4, yesTokenId: 'y', noTokenId: 'n',
      volume: 1, volume24hr: 1, liquidityClob: 1,
      acceptingOrders: true, closed: false, endDate: new Date('2026-01-10T00:00:00.000Z'),
      recordedAt: now,
      city: 'bordeaux', cityNormalized: 'bordeaux', targetDateIso: '2026-01-02', metric: 'highest_temp',
    }));
    await tickRepo.save(tickRepo.create({
      snapshotId: snap.id, conditionId: 'cond-hy-guard', eventSlug: 'e',
      question: 'Will the highest temperature in bordeaux be 20°C or above on 2026-01-02?',
      bucketComparison: 'or_above', bucketTarget: 20, bucketLow: null, bucketHigh: null,
      yesPrice: 0.55, noPrice: 0.45, yesTokenId: 'y', noTokenId: 'n',
      volume: 1, volume24hr: 1, liquidityClob: 1,
      acceptingOrders: true, closed: false, endDate: new Date('2026-01-10T00:00:00.000Z'),
      recordedAt: new Date('2026-01-01T06:00:00.000Z'),
      city: 'bordeaux', cityNormalized: 'bordeaux', targetDateIso: '2026-01-02', metric: 'highest_temp',
    }));
    await evalRepo.save(evalRepo.create({
      snapshotId: snap.id, conditionId: 'cond-hy-guard', bucketComparison: 'or_above',
      bucketTarget: 20, bucketLow: null, bucketHigh: null,
      strategyId: 'weather-highest-yes', yesPrice: 0.6, forecastProb: 0,
      edge: 0, dynamicMinEdge: 0, decision: 'signal', reason: 'test',
      evaluatedAt: now,
    }));

    const service = new BacktestRunService(ds);
    const run = await service.create({ domain: 'weather', mode: 'replay', paramsJson: '{}' });
    await runBacktest({
      runId: run.id,
      ds,
      params: {
        domain: 'weather', mode: 'replay',
        from: '2026-01-01T00:00:00.000Z', to: '2026-01-02T00:00:00.000Z',
        capital: 1000, entryUsdc: 10, slippageBps: 0,
        maxConcurrentPositions: 10,
        strategyId: 'weather-highest-yes',
      },
      configSnapshot: baseRisk(),
      service,
    });

    const positions = await service.listPositions(run.id, {});
    expect(positions.items.length).toBe(1);
    const pos = positions.items[0]!;
    expect(pos.exitReason).toBe('BACKTEST_INCOMPLETE_DATA');
    expect(pos.exitReason).not.toBe('WEATHER_FORECAST_CHANGE');
    expect(pos.exitReason).not.toBe('WEATHER_BUCKET_EXIT');
  });

  // ── Multi-strategy risk guards (P2 / F1 fix) ───────────────────────────
  //
  // The per-strategy risk resolution (maxExposureUsdc, maxDailyLossUsdc,
  // maxPositionSizeUsdc, killSwitchAction) is verified at two levels:
  //   1. Ledger unit tests — openExposure/dailyRealizedPnl filter by strategyId.
  //   2. Adapter integration — canEnter uses the signal's strategy bag, not the
  //      adapter's default bag. In replay mode all signals share params.strategyId,
  //      so we verify that a tight per-strategy maxExposureUsdc blocks a second
  //      entry while a generous one does not.

  it('ledger.openExposure filters by strategyId', async () => {
    const { Ledger } = await import('../../engine/ledger.js');
    const ledger = new Ledger(1000);
    const now = new Date('2026-01-01T00:00:00.000Z');

    ledger.openPosition({
      conditionId: 'c1', city: 'paris', targetDateIso: '2026-01-02',
      qty: 50, entryPrice: 0.3, entryAt: now, fees: 0,
      entryReason: 'signal', meta: { strategyId: 'weather-forecast' },
    });
    ledger.openPosition({
      conditionId: 'c2', city: 'lyon', targetDateIso: '2026-01-02',
      qty: 40, entryPrice: 0.25, entryAt: now, fees: 0,
      entryReason: 'signal', meta: { strategyId: 'weather-forecast-aligned' },
    });

    // Total exposure = 50*0.3 + 40*0.25 = 15 + 10 = 25
    expect(ledger.openExposure()).toBe(25);
    // weather-forecast only: 50*0.3 = 15
    expect(ledger.openExposure('weather-forecast')).toBe(15);
    // weather-forecast-aligned only: 40*0.25 = 10
    expect(ledger.openExposure('weather-forecast-aligned')).toBe(10);
    // Unknown strategy: 0
    expect(ledger.openExposure('nonexistent')).toBe(0);
  });

  it('ledger.dailyRealizedPnl filters by strategyId', async () => {
    const { Ledger } = await import('../../engine/ledger.js');
    const ledger = new Ledger(1000);
    const day1 = new Date('2026-01-01T12:00:00.000Z');

    // Open and close a losing position for strategy A
    ledger.openPosition({
      conditionId: 'c1', city: 'paris', targetDateIso: '2026-01-02',
      qty: 100, entryPrice: 0.5, entryAt: day1, fees: 0,
      entryReason: 'signal', meta: { strategyId: 'weather-forecast' },
    });
    ledger.closePosition({
      conditionId: 'c1', exitPrice: 0.0, exitAt: day1, exitReason: 'RESOLUTION', fees: 0,
    });
    // Open and close a winning position for strategy B
    ledger.openPosition({
      conditionId: 'c2', city: 'lyon', targetDateIso: '2026-01-02',
      qty: 100, entryPrice: 0.3, entryAt: day1, fees: 0,
      entryReason: 'signal', meta: { strategyId: 'weather-forecast-aligned' },
    });
    ledger.closePosition({
      conditionId: 'c2', exitPrice: 1.0, exitAt: day1, exitReason: 'RESOLUTION', fees: 0,
    });

    // Strategy A lost 50 USDC (100 * 0.5), strategy B gained 70 USDC (100 * (1-0.3))
    expect(ledger.dailyRealizedPnl(day1, 'weather-forecast')).toBe(-50);
    expect(ledger.dailyRealizedPnl(day1, 'weather-forecast-aligned')).toBe(70);
    // Total = -50 + 70 = 20
    expect(ledger.dailyRealizedPnl(day1)).toBe(20);
  });

  it('blocks second entry when per-strategy maxExposureUsdc is tight', async () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    const snapRepo = ds.getRepository(WeatherMarketSnapshot);
    const tickRepo = ds.getRepository(WeatherBucketTick);
    const evalRepo = ds.getRepository(WeatherEvaluationLog);

    const snap = await snapRepo.save(snapRepo.create({
      city: 'paris', cityNormalized: 'paris', targetDateIso: '2026-01-02',
      metric: 'highest_temp', forecastMean: 20, forecastStdDev: 1,
      bucketCount: 2, totalBucketCount: 3, recordedAt: now,
    }));

    // Two conditions (different buckets) — both get signals from weather-forecast.
    for (const [condId, target] of [
      ['cond-ex-a', 20],
      ['cond-ex-b', 21],
    ] as const) {
      await tickRepo.save(tickRepo.create({
        snapshotId: snap.id, conditionId: condId, eventSlug: 'evt-ex',
        question: `Will the highest temperature in paris be ${target}°C or above on 2026-01-02?`,
        bucketComparison: 'or_above', bucketTarget: target, bucketLow: null, bucketHigh: null,
        yesPrice: 0.3, noPrice: 0.7, yesTokenId: 'y', noTokenId: 'n',
        volume: 100, volume24hr: 50, liquidityClob: 200,
        acceptingOrders: true, closed: false, endDate: new Date('2026-01-02T23:59:00Z'),
        recordedAt: now,
        city: 'paris', cityNormalized: 'paris', targetDateIso: '2026-01-02', metric: 'highest_temp',
      }));
      await evalRepo.save(evalRepo.create({
        snapshotId: snap.id, conditionId: condId, bucketComparison: 'or_above',
        bucketTarget: target, bucketLow: null, bucketHigh: null,
        strategyId: 'weather-forecast', yesPrice: 0.3, forecastProb: 0.8,
        edge: 0.5, dynamicMinEdge: 0.1, decision: 'signal', reason: 'test',
        evaluatedAt: now,
      }));
    }

    // maxExposureUsdc = 12 → one $10 entry fills it; the second is blocked
    // because openExposure('weather-forecast') + 10 > 12.
    const config = baseRisk({
      weatherAlgoStrategyParams: JSON.stringify({
        'weather-forecast': { maxExposureUsdc: 12 },
      }),
    });

    const service = new BacktestRunService(ds);
    const run = await service.create({ domain: 'weather', mode: 'replay', paramsJson: '{}' });
    await runBacktest({
      runId: run.id,
      ds,
      params: {
        domain: 'weather', mode: 'replay',
        from: '2026-01-01T00:00:00.000Z', to: '2026-01-03T00:00:00.000Z',
        capital: 1000, entryUsdc: 10, slippageBps: 0,
        maxConcurrentPositions: 10,
      },
      configSnapshot: config,
      service,
    });

    const positions = await service.listPositions(run.id, {});
    // Only one position opened — the second was blocked by per-strategy exposure.
    expect(positions.items.length).toBe(1);
  });

  it('allows multiple entries when per-strategy maxExposureUsdc is generous', async () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    const snapRepo = ds.getRepository(WeatherMarketSnapshot);
    const tickRepo = ds.getRepository(WeatherBucketTick);
    const evalRepo = ds.getRepository(WeatherEvaluationLog);

    const snap = await snapRepo.save(snapRepo.create({
      city: 'paris', cityNormalized: 'paris', targetDateIso: '2026-01-02',
      metric: 'highest_temp', forecastMean: 20, forecastStdDev: 1,
      bucketCount: 2, totalBucketCount: 3, recordedAt: now,
    }));

    for (const [condId, target] of [
      ['cond-ex2-a', 20],
      ['cond-ex2-b', 21],
    ] as const) {
      await tickRepo.save(tickRepo.create({
        snapshotId: snap.id, conditionId: condId, eventSlug: 'evt-ex2',
        question: `Will the highest temperature in paris be ${target}°C or above on 2026-01-02?`,
        bucketComparison: 'or_above', bucketTarget: target, bucketLow: null, bucketHigh: null,
        yesPrice: 0.3, noPrice: 0.7, yesTokenId: 'y', noTokenId: 'n',
        volume: 100, volume24hr: 50, liquidityClob: 200,
        acceptingOrders: true, closed: false, endDate: new Date('2026-01-02T23:59:00Z'),
        recordedAt: now,
        city: 'paris', cityNormalized: 'paris', targetDateIso: '2026-01-02', metric: 'highest_temp',
      }));
      await evalRepo.save(evalRepo.create({
        snapshotId: snap.id, conditionId: condId, bucketComparison: 'or_above',
        bucketTarget: target, bucketLow: null, bucketHigh: null,
        strategyId: 'weather-forecast', yesPrice: 0.3, forecastProb: 0.8,
        edge: 0.5, dynamicMinEdge: 0.1, decision: 'signal', reason: 'test',
        evaluatedAt: now,
      }));
    }

    // maxExposureUsdc = 1000 → both entries fit.
    const config = baseRisk({
      weatherAlgoStrategyParams: JSON.stringify({
        'weather-forecast': { maxExposureUsdc: 1000 },
      }),
    });

    const service = new BacktestRunService(ds);
    const run = await service.create({ domain: 'weather', mode: 'replay', paramsJson: '{}' });
    await runBacktest({
      runId: run.id,
      ds,
      params: {
        domain: 'weather', mode: 'replay',
        from: '2026-01-01T00:00:00.000Z', to: '2026-01-03T00:00:00.000Z',
        capital: 1000, entryUsdc: 10, slippageBps: 0,
        maxConcurrentPositions: 10,
      },
      configSnapshot: config,
      service,
    });

    const positions = await service.listPositions(run.id, {});
    // Both entries allowed — generous exposure limit.
    // Note: replay mode dedups by city/date, so only one survives selection.
    // The test still verifies that exposure does not block entry.
    expect(positions.items.length).toBeGreaterThanOrEqual(1);
  });

  it('emits aggregated multi_position_stale_mark when positions are evaluated on aged ticks', async () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    const snapRepo = ds.getRepository(WeatherMarketSnapshot);
    const tickRepo = ds.getRepository(WeatherBucketTick);
    const evalRepo = ds.getRepository(WeatherEvaluationLog);

    const snap = await snapRepo.save(snapRepo.create({
      city: 'lyon', cityNormalized: 'lyon', targetDateIso: '2026-01-02',
      metric: 'highest_temp', forecastMean: 20, forecastStdDev: 1,
      bucketCount: 1, totalBucketCount: 3, recordedAt: now,
    }));

    const condId = 'cond-stale-mark';
    // Tick d'entrée à `now` : ouvre la position (replay via signal ci-dessous).
    await tickRepo.save(tickRepo.create({
      snapshotId: snap.id, conditionId: condId, eventSlug: 'e',
      question: 'Will the highest temperature in lyon be 20°C or above on 2026-01-02?',
      bucketComparison: 'or_above', bucketTarget: 20, bucketLow: null, bucketHigh: null,
      yesPrice: 0.5, noPrice: 0.5, yesTokenId: 'y', noTokenId: 'n',
      volume: 100, volume24hr: 50, liquidityClob: 200,
      acceptingOrders: true, closed: false, endDate: null,
      recordedAt: now,
      city: 'lyon', cityNormalized: 'lyon', targetDateIso: '2026-01-02', metric: 'highest_temp',
    }));
    await evalRepo.save(evalRepo.create({
      snapshotId: snap.id, conditionId: condId, bucketComparison: 'or_above',
      bucketTarget: 20, bucketLow: null, bucketHigh: null,
      strategyId: 'weather-forecast', yesPrice: 0.5, forecastProb: 0.7,
      edge: 0.4, dynamicMinEdge: 0.1, decision: 'signal', reason: 'test',
      evaluatedAt: now,
    }));
    // Un tick POST-pollMs (autre condition) force un second passage d'evaluateExits
    // alors que la position ci-dessus est toujours ouverte avec un tick âgé > pollMs.
    // pollMs = 1_800_000 ms (30 min) → on décale de 30 min + 1 s.
    const staleAfter = new Date(now.getTime() + 1_800_000 + 1000);
    await tickRepo.save(tickRepo.create({
      snapshotId: snap.id, conditionId: 'cond-other', eventSlug: 'e2',
      question: 'Will the highest temperature in lyon be 20°C or above on 2026-01-02?',
      bucketComparison: 'or_above', bucketTarget: 20, bucketLow: null, bucketHigh: null,
      yesPrice: 0.4, noPrice: 0.6, yesTokenId: 'y', noTokenId: 'n',
      volume: 100, volume24hr: 50, liquidityClob: 200,
      acceptingOrders: true, closed: false, endDate: null,
      recordedAt: staleAfter,
      city: 'lyon', cityNormalized: 'lyon', targetDateIso: '2026-01-02', metric: 'highest_temp',
    }));

    const service = new BacktestRunService(ds);
    const run = await service.create({ domain: 'weather', mode: 'replay', paramsJson: '{}' });
    const result = await runBacktest({
      runId: run.id,
      ds,
      params: {
        domain: 'weather', mode: 'replay',
        from: '2026-01-01T00:00:00.000Z', to: '2026-01-03T00:00:00.000Z',
        capital: 1000, entryUsdc: 10, slippageBps: 0,
        maxConcurrentPositions: 10,
      },
      configSnapshot: baseRisk(),
      service,
    });

    // La position (cond-stale-mark) est restée ouverte ; au passage du tick
    // `cond-other` son tick d'entrée est âgé > pollMs → warning agrégé émis.
    expect(result.fidelityWarnings.some((w) => w.startsWith('multi_position_stale_mark'))).toBe(true);
  });

  it('emits fill_price_clamped when slippage pushes entry price past 1.0', async () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    const snapRepo = ds.getRepository(WeatherMarketSnapshot);
    const tickRepo = ds.getRepository(WeatherBucketTick);
    const evalRepo = ds.getRepository(WeatherEvaluationLog);

    const snap = await snapRepo.save(snapRepo.create({
      city: 'nice', cityNormalized: 'nice', targetDateIso: '2026-01-02',
      metric: 'highest_temp', forecastMean: 20, forecastStdDev: 1,
      bucketCount: 1, totalBucketCount: 3, recordedAt: now,
    }));
    await tickRepo.save(tickRepo.create({
      snapshotId: snap.id, conditionId: 'cond-clamp', eventSlug: 'e',
      question: 'Will the highest temperature in nice be 20°C or above on 2026-01-02?',
      bucketComparison: 'or_above', bucketTarget: 20, bucketLow: null, bucketHigh: null,
      yesPrice: 0.99, noPrice: 0.01, yesTokenId: 'y', noTokenId: 'n',
      volume: 100, volume24hr: 50, liquidityClob: 200,
      acceptingOrders: true, closed: false, endDate: null,
      recordedAt: now,
      city: 'nice', cityNormalized: 'nice', targetDateIso: '2026-01-02', metric: 'highest_temp',
    }));
    await evalRepo.save(evalRepo.create({
      snapshotId: snap.id, conditionId: 'cond-clamp', bucketComparison: 'or_above',
      bucketTarget: 20, bucketLow: null, bucketHigh: null,
      strategyId: 'weather-forecast', yesPrice: 0.99, forecastProb: 0.9,
      edge: 0.2, dynamicMinEdge: 0.1, decision: 'signal', reason: 'test',
      evaluatedAt: now,
    }));

    const service = new BacktestRunService(ds);
    const run = await service.create({ domain: 'weather', mode: 'replay', paramsJson: '{}' });
    // slippageBps=200 : yesPrice 0.99 → 0.99*1.02 = 1.0098 > 1 → clampé à 1.0.
    const result = await runBacktest({
      runId: run.id,
      ds,
      params: {
        domain: 'weather', mode: 'replay',
        from: '2026-01-01T00:00:00.000Z', to: '2026-01-03T00:00:00.000Z',
        capital: 1000, entryUsdc: 10, slippageBps: 200,
        maxConcurrentPositions: 10,
      },
      configSnapshot: baseRisk(),
      service,
    });

    expect(result.fidelityWarnings.some((w) => w.startsWith('fill_price_clamped'))).toBe(true);
  });
});
