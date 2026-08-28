import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DataSource } from 'typeorm';
import { createTestDataSource, initializeDataSource, type WeatherConfig } from '@polywatch/core';
import { WeatherMarketSnapshot, WeatherBucketTick, WeatherForecastHistory } from '@polywatch/core';
import { runBacktest } from '../../index.js';
import type { WeatherSignal } from '@polywatch/weather-algo';
import { pairDecidedAtBySignal } from './weather-adapter.js';
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

describe('runBacktest (weather reevaluate)', () => {
  let ds: DataSource;

  beforeEach(async () => {
    ds = await initializeDataSource(createTestDataSource());
  });

  afterEach(async () => {
    await ds.destroy();
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

  // ── Multi-strategy risk guards (P2 / F1 fix) ───────────────────────────
  //
  // The per-strategy risk resolution (maxExposureUsdc, maxDailyLossUsdc,
  // maxPositionSizeUsdc, killSwitchAction) is verified at two levels:
  //   1. Ledger unit tests — openExposure/dailyRealizedPnl filter by strategyId.
  //   2. Adapter integration — canEnter uses the signal's strategy bag, not the
  //      adapter's default bag. In reevaluate mode all signals share params.strategyId,
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

  it('pairDecidedAtBySignal keeps each signal own decidedAt by object identity (F5)', () => {
    const t1 = new Date('2026-01-01T00:00:00.000Z');
    const t2 = new Date('2026-01-01T00:00:00.500Z');
    const s1: WeatherSignal = {
      conditionId: 'cond-x', assetId: 'a1', outcome: 'YES', side: 'BUY',
      confidence: 0.5, reasons: [], strategyId: 'weather-forecast', mode: 'sim',
      eventSlug: 'evt', city: 'paris', metric: 'highest_temp',
      targetDate: new Date('2026-08-02T12:00:00Z'),
      forecastMean: 0, forecastStdDev: 0, forecastProbability: 0, marketPrice: 0,
      edge: 0.3, dynamicMinEdge: 0,
    };
    const s2: WeatherSignal = {
      conditionId: 'cond-x', assetId: 'a2', outcome: 'YES', side: 'BUY',
      confidence: 0.5, reasons: [], strategyId: 'weather-forecast', mode: 'sim',
      eventSlug: 'evt', city: 'paris', metric: 'highest_temp',
      targetDate: new Date('2026-08-02T12:00:00Z'),
      forecastMean: 0, forecastStdDev: 0, forecastProbability: 0, marketPrice: 0,
      edge: 0.2, dynamicMinEdge: 0,
    };
    const map = pairDecidedAtBySignal([
      { signal: s1, decidedAt: t1 },
      { signal: s2, decidedAt: t2 },
    ]);
    // Deux signaux du même conditionId : chacun garde son decidedAt.
    expect(map.get(s1)).toBe(t1);
    expect(map.get(s2)).toBe(t2);
  });

  it('reevaluate: flush runs before reentry throttle guard and drops pending signal (F4)', async () => {
    // Deux buckets london (cond-12 ouvert, cond-13 en pending). À la résolution
    // de cond-12, markClosed active le throttle ville/date. Le flush doit se faire
    // AVANT la garde throttle de onBookTick et dropper cond-13 (isReentryBlocked
    // dans flushPendingRunnerSimSignals). Sans le fix, le tick throttle retourne
    // avant le flush → S13 reste pending jusqu'à finish() ou un tick post-throttle.
    const t0 = new Date('2026-01-01T00:00:00.000Z');
    const t1 = new Date(t0.getTime() + 2_000);
    const t1b = new Date(t0.getTime() + 2_100);
    const t2 = new Date(t0.getTime() + 4_000);
    const snapRepo = ds.getRepository(WeatherMarketSnapshot);
    const tickRepo = ds.getRepository(WeatherBucketTick);
    const histRepo = ds.getRepository(WeatherForecastHistory);

    const snap12 = await snapRepo.save(snapRepo.create({
      city: 'london', cityNormalized: 'london', targetDateIso: '2026-01-02',
      metric: 'highest_temp', forecastMean: 12, forecastStdDev: 1.5,
      bucketCount: 1, totalBucketCount: 3, ruleId: 1, recordedAt: t0,
    }));
    const snap13 = await snapRepo.save(snapRepo.create({
      city: 'london', cityNormalized: 'london', targetDateIso: '2026-01-02',
      metric: 'highest_temp', forecastMean: 12, forecastStdDev: 1.5,
      bucketCount: 1, totalBucketCount: 3, ruleId: 1, recordedAt: t0,
    }));

    await histRepo.save(histRepo.create({
      city: 'london', forecastDate: new Date('2026-01-02T12:00:00Z'),
      metric: 'highest_temp', forecastMean: 12, forecastStdDev: 1.5,
      modelValuesJson: '{}', latitude: 51.5, longitude: -0.1, fetchedAt: t0,
    }));

    const tickFields = {
      eventSlug: 'evt-london', bucketComparison: 'or_above' as const,
      bucketLow: null, bucketHigh: null, yesTokenId: 'yes', noTokenId: 'no',
      volume: 100, volume24hr: 50, liquidityClob: 200, metric: 'highest_temp',
      targetDateIso: '2026-01-02', city: 'london', cityNormalized: 'london',
      acceptingOrders: true, closed: false,
      endDate: new Date('2026-01-02T23:59:00Z'),
    };
    const tick12 = (price: number, recordedAt: Date) => tickRepo.create({
      ...tickFields, snapshotId: snap12.id,
      question: 'Will the highest temperature in london be 12°C or above on 2026-01-02?',
      bucketTarget: 12, conditionId: 'cond-london-12',
      yesPrice: price, noPrice: 1 - price, recordedAt,
    });
    const tick13 = (price: number, recordedAt: Date) => tickRepo.create({
      ...tickFields, snapshotId: snap13.id,
      question: 'Will the highest temperature in london be 13°C or above on 2026-01-02?',
      bucketTarget: 13, conditionId: 'cond-london-13',
      yesPrice: price, noPrice: 1 - price, recordedAt,
    });

    // t0 : signal cond-12 pending. t1 : flush ouvre cond-12. t1b : signal cond-13
    // pending (autre bucket, maxPositionsPerCityDate=2). t2 : résolution cond-12 +
    // flush droppe cond-13 (throttle actif).
    await tickRepo.save(tick12(0.3, t0));
    await tickRepo.save(tick12(0.3, t1));
    await tickRepo.save(tick13(0.35, t1b));
    await tickRepo.save(tick12(0.99, t2));

    const service = new BacktestRunService(ds);
    const run = await service.create({ domain: 'weather', mode: 'reevaluate', paramsJson: '{}' });
    await runBacktest({
      runId: run.id, ds,
      params: {
        domain: 'weather', mode: 'reevaluate',
        from: '2026-01-01T00:00:00.000Z', to: '2026-01-04T00:00:00.000Z',
        capital: 1000, entryUsdc: 10, slippageBps: 0,
        maxConcurrentPositions: 2,
      },
      configSnapshot: baseRisk({
        weatherAlgoReentryThrottleMs: 60_000,
        weatherAlgoStrategyParams: JSON.stringify({
          'weather-forecast': { maxPositionsPerCityDate: 2 },
        }),
      }),
      service,
    });

    const positions = await service.listPositions(run.id, {});
    expect(positions.items.some((p) => p.conditionId === 'cond-london-12')).toBe(true);
    // cond-13 ne doit jamais s'ouvrir : droppé au flush (throttle) sur le tick de
    // résolution de cond-12, pas re-fillé à finish() ni plus tard.
    expect(positions.items.some((p) => p.conditionId === 'cond-london-13')).toBe(false);
    expect(positions.items.length).toBe(1);
  });
});
