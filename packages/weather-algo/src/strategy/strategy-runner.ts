import pino from 'pino';
import { In, MoreThanOrEqual, type DataSource } from 'typeorm';
import type { Redis } from 'ioredis';
import {
  type MarketListItemDto,
  type WeatherConfig,
  type WeatherForecastService,
  type WeatherAutoTrackService,
  type WeatherAutoTrackRule,
  type WeatherForecastHistoryRecorder,
  type WeatherMarketSnapshotRecorder,
  type WeatherEvaluationRecorder,
  type EvaluationLogInput,
  type BucketTickInput,
  CopiedPosition,
  WeatherPositionForecast,
  PositionReservation,
  discoverWeatherMarkets,
  discoverResolvedWeatherMarkets,
  DEFAULT_RESOLVED_LOOKBACK_DAYS,
  parseWeatherQuestion,
  normalizeWeatherCity,
  buildLookAheadTargetDates,
  isWeatherMetric,
  type WeatherMetric,
  resolveMarketTargetDateIso,
  isMarketActiveForWeather,
  type BucketCandidate,
  resolveEnabledWeatherStrategies,
  getStrategyParams,
  WEATHER_HIGHEST_YES_STRATEGY_ID,
  type WeatherStrategyId,
} from '@polywatch/core';
import type { WeatherStrategyRegistry } from './registry.js';
import type { WeatherSignal, WeatherStrategy, WeatherEvaluationResult } from './strategy.js';
import { resolveBucketPrices } from './runner-bucket-helpers.js';
import { dedupSignalsByCityDate, applySelectionMode } from './strategy-runner-selection.js';
import { WeatherAlgoRuntimeStatusPublisher } from '../runtime-status.js';
import type { WeatherExitEvaluator } from '../processors/weather-exit-evaluator.js';
import { WEATHER_FORECAST_CACHE_TTL_MS_DEFAULT } from '../config.js';

const log = pino({ name: 'weather-algo:strategy-runner' });

export interface StrategyRunnerParams {
  ds: DataSource;
  autoTrackService: WeatherAutoTrackService;
  forecastService: WeatherForecastService;
  registry: WeatherStrategyRegistry;
  redisCmd: Redis;
  onSignal: (signal: WeatherSignal) => Promise<boolean>;
  pollMs: number;
  forecastCacheTtlMs?: number;
  runtimeStatus?: WeatherAlgoRuntimeStatusPublisher;
  exitEvaluator?: WeatherExitEvaluator;
  onParseResult?: (parsed: boolean) => void;
  forecastHistoryRecorder?: WeatherForecastHistoryRecorder;
  marketSnapshotRecorder?: WeatherMarketSnapshotRecorder;
  evaluationRecorder?: WeatherEvaluationRecorder;
}

export class WeatherStrategyRunner {
  private timer: NodeJS.Timeout | null = null;
  private cycleRunning = false;
  private pendingRerun = false;
  private stopped = false;
  private readonly ds: DataSource;
  private readonly autoTrackService: WeatherAutoTrackService;
  private readonly forecastService: WeatherForecastService;
  private readonly registry: WeatherStrategyRegistry;
  private readonly redisCmd: Redis;
  private readonly onSignal: (signal: WeatherSignal) => Promise<boolean>;
  private pollMs: number;
  private readonly forecastCacheTtlMs: number;
  private risk: WeatherConfig | null = null;
  private runtimeStatus?: WeatherAlgoRuntimeStatusPublisher;
  private exitEvaluator?: WeatherExitEvaluator;
  private readonly onParseResult?: (parsed: boolean) => void;
  private readonly forecastHistoryRecorder?: WeatherForecastHistoryRecorder;
  private readonly marketSnapshotRecorder?: WeatherMarketSnapshotRecorder;
  private readonly evaluationRecorder?: WeatherEvaluationRecorder;

  constructor(params: StrategyRunnerParams) {
    this.ds = params.ds;
    this.autoTrackService = params.autoTrackService;
    this.forecastService = params.forecastService;
    this.registry = params.registry;
    this.redisCmd = params.redisCmd;
    this.onSignal = params.onSignal;
    this.pollMs = params.pollMs;
    this.forecastCacheTtlMs = params.forecastCacheTtlMs ?? WEATHER_FORECAST_CACHE_TTL_MS_DEFAULT;
    this.runtimeStatus = params.runtimeStatus;
    this.exitEvaluator = params.exitEvaluator;
    this.onParseResult = params.onParseResult;
    this.forecastHistoryRecorder = params.forecastHistoryRecorder;
    this.marketSnapshotRecorder = params.marketSnapshotRecorder;
    this.evaluationRecorder = params.evaluationRecorder;
  }

  setRiskConfig(risk: WeatherConfig): void {
    this.risk = risk;
    const nextPoll = risk.weatherAlgoPollMs;
    if (nextPoll && nextPoll > 0) {
      if (nextPoll !== this.pollMs) {
        this.pollMs = nextPoll;
        if (this.timer) {
          this.restartPolling();
        }
      }
    }
    for (const strategy of this.registry.getAll()) {
      const bag = getStrategyParams(risk, strategy.id);
      strategy.setRiskConfig?.(bag);
    }
  }

  /**
   * Start the aligned poll scheduler. A boot-only exit pass re-evaluates open
   * positions immediately (recovery), then the first full cycle happens at the
   * next UTC-aligned poll slot. Entries are never triggered at boot.
   */
  start(): void {
    if (this.timer) return;
    this.stopped = false;
    this.pendingRerun = false;
    log.info({ pollMs: this.pollMs }, 'weather strategy runner started');
    void this.runBootExitPass().catch((err) =>
      log.error({ err }, 'weather boot exit pass failed'),
    );
    this.scheduleNextTick();
  }

  /**
   * Boot-only exit re-evaluation. Reuses the same exit pass that runs at the
   * start of each cycle so open positions (pre-close, bucket-exit, drift) are
   * re-checked immediately after a restart instead of waiting up to `pollMs`
   * for the first aligned slot. Does not emit entry signals.
   */
  private async runBootExitPass(): Promise<void> {
    if (this.stopped) return;
    if (!this.exitEvaluator) return;
    try {
      await this.exitEvaluator.evaluateOpenPositions();
    } catch (err) {
      log.error({ err }, 'weather boot exit evaluation failed');
    }
  }

  stop(): void {
    this.stopped = true;
    this.pendingRerun = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /**
   * Recreate the poll timer with the current pollMs, re-aligning on the next
   * UTC slot. Does not trigger an evaluation cycle (caller is responsible for
   * requestEvaluationCycle).
   */
  restartPolling(): void {
    if (this.stopped) return;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    log.info({ pollMs: this.pollMs }, 'weather strategy runner poll restarted');
    this.scheduleNextTick();
  }

  /**
   * Request an evaluation cycle. If one is already running, schedule a single
   * trailing rerun after it finishes (pendingRerun).
   */
  requestEvaluationCycle(): void {
    if (this.stopped) return;
    void this.runEvaluationCycleGuarded().catch((err) =>
      log.error({ err }, 'weather strategy evaluation cycle failed'),
    );
  }

  /**
   * Schedule the next evaluation cycle on a fixed UTC-aligned grid: the poll
   * fires at the next multiple of `pollMs` since Unix epoch (i.e. UTC midnight).
   * This makes the cadence independent of process start time — a 15 min poll
   * always lands on :00/:15/:30/:45 UTC, even across restarts. Each run
   * re-schedules itself, so execution drift is absorbed.
   */
  private scheduleNextTick(): void {
    if (this.stopped) return;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const now = Date.now();
    const delay = Math.max(0, Math.ceil(now / this.pollMs) * this.pollMs - now);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.runEvaluationCycleGuarded().finally(() => this.scheduleNextTick());
    }, delay);
  }

  private async runEvaluationCycleGuarded(): Promise<void> {
    if (this.stopped) return;
    if (this.cycleRunning) {
      this.pendingRerun = true;
      log.debug('skip_overlapping_cycle — pendingRerun set');
      return;
    }

    this.cycleRunning = true;
    try {
      await this.runEvaluationCycle();
    } finally {
      this.cycleRunning = false;
      if (this.pendingRerun && !this.stopped) {
        this.pendingRerun = false;
        this.requestEvaluationCycle();
      } else {
        this.pendingRerun = false;
      }
    }
  }

  private async runEvaluationCycle(): Promise<void> {
    const status = {
      evaluableSelections: 0,
      lastEvaluatedAt: null as number | null,
      lastSkipReason: null as string | null,
      lastSkipAt: null as number | null,
      activeStrategies: [] as string[],
    };

    // Snapshot config at cycle start — safe reload: mid-cycle config changes apply next cycle.
    const risk = this.risk;
    const enabledStrategyIds: WeatherStrategyId[] = risk
      ? resolveEnabledWeatherStrategies(risk)
      : [];
    status.activeStrategies = [...enabledStrategyIds];
    const strategies = this.registry.getOrdered(enabledStrategyIds);

    try {
      if (!risk) {
        status.lastSkipReason = 'no_risk_config';
        status.lastSkipAt = Date.now();
        return;
      }

      // 1. Exits first — avoids opening a new bucket before closing the old one
      if (this.exitEvaluator) {
        try {
          await this.exitEvaluator.evaluateOpenPositions();
        } catch (err) {
          log.error({ err }, 'weather exit evaluation failed');
        }
      }

      if (!risk.weatherAlgoEnabled) {
        status.lastSkipReason = 'disabled';
        status.lastSkipAt = Date.now();
        log.debug('weather-algo disabled — skipping entry evaluation');
        return;
      }

      if (strategies.length === 0) {
        status.lastSkipReason = 'no_strategies';
        status.lastSkipAt = Date.now();
        log.warn({ enabledStrategyIds }, 'no registered strategies for enabled ids');
        return;
      }

      const cityFollowRules = await this.loadCityFollowRules();
      status.evaluableSelections = cityFollowRules.length;

      if (cityFollowRules.length === 0) {
        status.lastSkipReason = 'no_city_rules';
        status.lastSkipAt = Date.now();
        status.lastEvaluatedAt = Date.now();
        return;
      }

      const maxLookAhead = Math.max(
        1,
        ...cityFollowRules.map((r) => r.lookAheadDays ?? 1),
      );
      const discoveryTargetDates = buildLookAheadTargetDates(maxLookAhead);
      const discovery = await discoverWeatherMarkets({
        limit: 100,
        targetDates: discoveryTargetDates,
      });
      const openCityDates = await this.loadOpenWeatherCityDates();

      // Fix B: fetch resolved (closed) weather markets for snapshot recording only.
      // Targets a rolling past-day window since resolved markets only concern past dates.
      let resolvedMarkets: MarketListItemDto[] = [];
      if (risk.weatherAlgoMarketSnapshotRecordingEnabled) {
        try {
          const resolved = await discoverResolvedWeatherMarkets({
            lookbackDays: DEFAULT_RESOLVED_LOOKBACK_DAYS,
          });
          resolvedMarkets = resolved.resolvedTemperatureMarkets;
          log.info(
            { resolvedCount: resolvedMarkets.length },
            'resolved weather markets discovery complete',
          );
        } catch (err) {
          log.warn({ err }, 'resolved weather discovery failed — continuing without resolved buckets');
        }
      }

      log.info(
        {
          ruleCount: cityFollowRules.length,
          openCityDates: [...openCityDates.keys()],
          maxLookAhead,
          activeStrategies: enabledStrategyIds,
          targetDates: discoveryTargetDates.map((d) => d.toISOString().slice(0, 10)),
          resolvedMarkets: resolvedMarkets.length,
        },
        'evaluating city-follow rules',
      );

      const allSignals = await this.evaluateCityFollowRules(
        cityFollowRules,
        discovery.temperatureMarkets,
        resolvedMarkets,
        openCityDates,
        strategies,
      );

      const dedupedSignals = dedupSignalsByCityDate(allSignals);
      const selectedSignals = applySelectionMode(dedupedSignals, risk);

      // Safety guard: enforce max open positions per (city, target date, strategy)
      // across the emitted batch. dedupedSignals already carries at most one
      // signal per (city, date, strategy) lane, but seenCityDates also counts
      // pairs that already have an open/pending position (defensive against any
      // upstream regression in the open city+date filter).
      const seenCityDates = new Map<string, number>(openCityDates);
      for (const signal of selectedSignals) {
        const cityDateKey = `${normalizeWeatherCity(signal.city)}|${signal.targetDate.toISOString().slice(0, 10)}|${signal.strategyId}`;
        const maxForStrategy = Math.max(
          1,
          getStrategyParams(risk, signal.strategyId).maxPositionsPerCityDate,
        );
        const current = seenCityDates.get(cityDateKey) ?? 0;
        if (current >= maxForStrategy) {
          log.debug({ city: signal.city, dateKey: cityDateKey, strategyId: signal.strategyId, conditionId: signal.conditionId }, 'skip signal — city+date+strategy already at capacity');
          continue;
        }
        try {
          const accepted = await this.onSignal(signal);
          if (accepted) {
            seenCityDates.set(cityDateKey, current + 1);
            log.info(
              { conditionId: signal.conditionId, eventSlug: signal.eventSlug, edge: signal.edge, city: signal.city, dateKey: cityDateKey },
              'weather signal accepted',
            );
          }
        } catch (err) {
          log.error({ err, conditionId: signal.conditionId }, 'weather signal dispatch failed');
        }
      }

      status.lastEvaluatedAt = Date.now();
    } catch (err) {
      log.error({ err }, 'weather strategy evaluation cycle failed');
      status.lastSkipReason = 'cycle_error';
      status.lastSkipAt = Date.now();
    } finally {
      await this.publishStatus(status);
    }
  }

  /**
   * Open WEATHER_OPEN positions keyed by `(normalizedCity|targetDateIso)` with a
   * count of how many positions are active for each (city, target date) pair.
   * Includes pending (reserved, not filled) and closing (exit enqueued / in progress)
   * so we never exceed `maxPositionsPerCityDate` for the same city+date+strategy.
   *
   * A pending position with quantity 0 is only considered active when it has a
   * non-expired reservation. Otherwise it is a stale zombie left by an earlier
   * failed entry and must not block the city+date.
   */
  private async loadOpenWeatherCityDates(): Promise<Map<string, number>> {
    const positions = await this.ds.getRepository(CopiedPosition).find({
      where: {
        reason: 'WEATHER_OPEN',
        status: In(['pending', 'open', 'closing']),
      },
    });
    if (positions.length === 0) return new Map();

    const activeIds = await this.resolveActiveWeatherPositionIds(positions);
    if (activeIds.size === 0) return new Map();

    const posById = new Map(positions.map((p) => [p.id, p]));
    const cityDates = new Map<string, number>();
    const snaps = await this.ds.getRepository(WeatherPositionForecast).find({
      where: { copiedPositionId: In([...activeIds]) },
    });
    for (const snap of snaps) {
      if (!snap.city) continue;
      const strategyId = posById.get(snap.copiedPositionId)?.strategyId ?? 'weather-forecast';
      const key = `${normalizeWeatherCity(snap.city)}|${snap.targetDate.toISOString().slice(0, 10)}|${strategyId}`;
      cityDates.set(key, (cityDates.get(key) ?? 0) + 1);
    }
    return cityDates;
  }

  /**
   * Returns the ids of weather positions that are truly active.
   * Open/closing/filled positions are active. Pending positions with quantity 0
   * are active only when backed by a non-expired reservation.
   */
  private async resolveActiveWeatherPositionIds(
    positions: CopiedPosition[],
  ): Promise<Set<number>> {
    const ids = positions.map((p) => p.id);
    const reservations = await this.ds.getRepository(PositionReservation).find({
      where: { copiedPositionId: In(ids), expiresAt: MoreThanOrEqual(new Date()) },
    });
    const reservedIds = new Set(reservations.map((r) => r.copiedPositionId));

    const active = new Set<number>();
    for (const p of positions) {
      if (
        p.status === 'open' ||
        p.status === 'closing' ||
        p.quantity > 0 ||
        (p.status === 'pending' && reservedIds.has(p.id))
      ) {
        active.add(p.id);
      }
    }
    return active;
  }

  private async loadCityFollowRules(): Promise<WeatherAutoTrackRule[]> {
    // City-first: every enabled auto-track rule is a watched city
    return this.autoTrackService.loadAllEnabled();
  }

  private async evaluateCityFollowRules(
    rules: WeatherAutoTrackRule[],
    temperatureMarkets: MarketListItemDto[],
    resolvedMarkets: MarketListItemDto[],
    openCityDates: Map<string, number>,
    strategies: WeatherStrategy[],
  ): Promise<WeatherSignal[]> {
    const signals: WeatherSignal[] = [];

    // Index resolved markets per city + date so we can inject them into the
    // snapshot for the matching city/date group (resolved-only, never traded).
    const resolvedByCityDate = new Map<string, MarketListItemDto[]>();
    for (const market of resolvedMarkets) {
      if (!market.question) continue;
      const parsed = parseWeatherQuestion(market.question);
      if (!parsed) continue;
      const dateKey = resolveMarketTargetDateIso(market);
      if (!dateKey) continue;
      const key = `${normalizeWeatherCity(parsed.city)}|${parsed.metric}|${dateKey}`;
      const arr = resolvedByCityDate.get(key);
      if (arr) arr.push(market);
      else resolvedByCityDate.set(key, [market]);
    }

    for (const rule of rules) {
      const cityKey = normalizeWeatherCity(rule.city);

      const targetDates = buildLookAheadTargetDates(rule.lookAheadDays ?? 1);
      const targetDateStrs = new Set(
        targetDates.map((d) => d.toISOString().slice(0, 10)),
      );

      const metricRaw = rule.metric || 'highest_temp';
      if (!isWeatherMetric(metricRaw)) {
        log.warn({ city: rule.city, metric: metricRaw }, 'city-follow: invalid metric — skipping rule');
        continue;
      }
      const metric: WeatherMetric = metricRaw;
      const matching: Array<{ market: MarketListItemDto; dateKey: string }> = [];
      for (const market of temperatureMarkets) {
        if (!market.question) continue;
        const parsed = parseWeatherQuestion(market.question);
        this.onParseResult?.(parsed != null);
        if (!parsed) continue;
        if (normalizeWeatherCity(parsed.city) !== cityKey) continue;
        if (parsed.metric !== metric) continue;

        const dateKey = resolveMarketTargetDateIso(market);
        if (!dateKey || !targetDateStrs.has(dateKey)) continue;

        matching.push({ market, dateKey });
      }

      // Even when no active markets are found for the look-ahead dates, still
      // record snapshots for the resolved past buckets of this city (if any).
      const hasResolvedForCity =
        Array.from(resolvedByCityDate.keys()).some((k) => k.startsWith(`${cityKey}|${metric}|`));

      if (matching.length === 0 && !hasResolvedForCity) {
        log.info({ city: rule.city, metric, targetDates: [...targetDateStrs] }, 'city-follow: no matching markets found');
        continue;
      }
      log.info({ city: rule.city, metric, matchingCount: matching.length, dates: [...new Set(matching.map((m) => m.dateKey))] }, 'city-follow: matching markets found');

      const byDate = new Map<string, MarketListItemDto[]>();
      for (const { market, dateKey } of matching) {
        const arr = byDate.get(dateKey);
        if (arr) arr.push(market);
        else byDate.set(dateKey, [market]);
      }

      // Collect the resolved bucket dates for this city so we still record a
      // snapshot for a city whose active markets are all gone but which has
      // resolved buckets to persist.
      for (const [key, markets] of resolvedByCityDate) {
        const prefix = `${cityKey}|${metric}|`;
        if (!key.startsWith(prefix)) continue;
        const dateKey = key.slice(prefix.length);
        if (!byDate.has(dateKey)) {
          byDate.set(dateKey, []);
        }
      }

      const citySignals: WeatherSignal[] = [];
      for (const [dateKey, markets] of byDate) {
        const resolvedForDate =
          resolvedByCityDate.get(`${cityKey}|${metric}|${dateKey}`) ?? [];
        try {
          const signal = await this.evaluateCityFollowDateGroup(
            rule.id,
            rule.city,
            metric,
            dateKey,
            markets,
            resolvedForDate,
            strategies,
            openCityDates,
          );
          if (signal) citySignals.push(signal);
        } catch (err) {
          log.error({ err, city: rule.city, dateKey }, 'city-follow date group evaluation failed');
        }
      }

      // Snapshot has already been recorded above regardless of open capacity.
      // Capacity is enforced per (city, date, strategy) inside
      // evaluateCityFollowDateGroup. Push one candidate per date:
      // evaluateCityFollowDateGroup returns at most one signal per date, so
      // multiple dates of the same city can coexist when each lane has capacity.
      for (const signal of citySignals) {
        signals.push(signal);
      }
    }

    return signals;
  }

  private async evaluateCityFollowDateGroup(
    ruleId: number,
    city: string,
    metric: WeatherMetric,
    dateKey: string,
    markets: MarketListItemDto[],
    resolvedMarkets: MarketListItemDto[],
    strategies: WeatherStrategy[],
    openCityDateCounts: Map<string, number>,
  ): Promise<WeatherSignal | null> {
    const targetDate = new Date(`${dateKey}T12:00:00Z`);
    if (Number.isNaN(targetDate.getTime())) {
      log.warn({ city, dateKey, metric }, 'city-follow: invalid dateKey — skipping');
      return null;
    }

    const allBuckets: BucketCandidate[] = [];
    for (const market of markets) {
      if (!market.question) continue;
      const parsed = parseWeatherQuestion(market.question);
      this.onParseResult?.(parsed != null);
      if (!parsed) continue;
      allBuckets.push({ conditionId: market.conditionId, market, parsed });
    }
    const activeBuckets = allBuckets.filter((b) =>
      isMarketActiveForWeather(b.market),
    );

    // Resolved buckets are injected into the snapshot only; they never enter
    // activeBuckets or the strategy evaluation / trading path.
    const resolvedBuckets: BucketCandidate[] = [];
    for (const market of resolvedMarkets) {
      if (!market.question) continue;
      const parsed = parseWeatherQuestion(market.question);
      if (!parsed) continue;
      resolvedBuckets.push({ conditionId: market.conditionId, market, parsed });
    }

    const forecast = await this.forecastService.getOrFetch(
      city,
      targetDate,
      metric,
      this.forecastCacheTtlMs,
    );

    if (
      forecast &&
      forecast.wasFetched &&
      !forecast.isStaleFallback &&
      this.risk?.weatherAlgoForecastHistoryRecordingEnabled &&
      this.forecastHistoryRecorder
    ) {
      try {
        await this.forecastHistoryRecorder.record({
          city,
          forecastDate: targetDate,
          metric,
          forecastMean: forecast.forecastMean,
          forecastStdDev: forecast.forecastStdDev,
          modelValues: forecast.modelValues,
          latitude: forecast.latitude,
          longitude: forecast.longitude,
        });
      } catch (err) {
        log.warn({ err, city, targetDate }, 'forecast history record failed — continuing');
      }
    }

    let snapshotId: number | null = null;
    const snapshotEnabled = this.risk?.weatherAlgoMarketSnapshotRecordingEnabled ?? false;
    const evalLogEnabled = this.risk?.weatherAlgoEvaluationLogRecordingEnabled ?? false;

    if (evalLogEnabled && !snapshotEnabled) {
      log.warn(
        { city, dateKey },
        'evaluation_log actif sans market_snapshot — snapshotId sera null',
      );
    }

    if (snapshotEnabled && this.marketSnapshotRecorder) {
      const snapshotBuckets = mergeBucketsForSnapshot(allBuckets, resolvedBuckets);
      const totalBucketCount = snapshotBuckets.length;
      const bucketInputs: BucketTickInput[] = snapshotBuckets.map((b) => {
        const prices = resolveBucketPrices(b.market);
        return {
          conditionId: b.market.conditionId,
          eventSlug: b.market.eventSlug ?? null,
          question: b.market.question ?? null,
          bucketComparison: b.parsed.comparison,
          bucketTarget: b.parsed.targetValue,
          bucketLow: b.parsed.targetValueLow,
          bucketHigh: b.parsed.targetValueHigh,
          unit: b.parsed.unit ?? null,
          yesPrice: prices.yesPrice,
          noPrice: prices.noPrice,
          yesTokenId: prices.yesTokenId,
          noTokenId: prices.noTokenId,
          volume: b.market.volume ?? null,
          volume24hr: b.market.volume24hr ?? null,
          liquidityClob: b.market.liquidityClob ?? null,
          acceptingOrders: b.market.acceptingOrders ?? null,
          closed: b.market.closed ?? false,
          endDate: b.market.endDate ? new Date(b.market.endDate) : null,
        };
      });

      try {
        const result = await this.marketSnapshotRecorder.recordSnapshot({
          city,
          cityNormalized: normalizeWeatherCity(city),
          targetDateIso: dateKey,
          metric,
          forecastMean: forecast?.forecastMean ?? null,
          forecastStdDev: forecast?.forecastStdDev ?? null,
          buckets: bucketInputs,
          totalBucketCount,
          ruleId,
          fidelityMinutes: this.pollMs > 0 ? Math.round(this.pollMs / 60_000) : null,
        });
        snapshotId = result.snapshotId;
      } catch (err) {
        log.warn({ err, city, dateKey }, 'market snapshot record failed — continuing without snapshot');
        snapshotId = null;
      }
    }

    if (!forecast) {
      const hasHighestYes = strategies.some((s) => s.id === WEATHER_HIGHEST_YES_STRATEGY_ID);
      if (!hasHighestYes) {
        log.warn({ city, dateKey, metric }, 'city-follow: forecast unavailable — skipping evaluate');
        return null;
      }
      // highest-yes activée : procéder avec un ctx placeholder, les stratégies
      // forecast-dépendantes s'abstiendront (proba forecast nulle → edge nul).
    }
    if (activeBuckets.length === 0) {
      log.debug({ city, dateKey, marketCount: markets.length }, 'city-follow: no active markets');
      return null;
    }

    const ctx = {
      forecastMean: forecast?.forecastMean ?? 0,
      forecastStdDev: forecast?.forecastStdDev ?? 0,
    };

    const evaluationInputs: EvaluationLogInput[] = [];
    const abstainReasons: string[] = [];
    const activeMarkets = activeBuckets.map((b) => b.market);

    for (const strategy of strategies) {
      const risk = this.risk;
      if (risk) {
        const laneKey = `${normalizeWeatherCity(city)}|${dateKey}|${strategy.id}`;
        const openCount = openCityDateCounts.get(laneKey) ?? 0;
        const maxForStrategy = Math.max(
          1,
          getStrategyParams(risk, strategy.id).maxPositionsPerCityDate,
        );
        if (openCount >= maxForStrategy) {
          abstainReasons.push(`${strategy.id}:city_date_at_capacity`);
          continue;
        }
      }

      let result: WeatherEvaluationResult = { kind: 'abstain', reason: 'no_signal' };
      // forecast-dependent strategies must abstain when the forecast is null.
      // Passing a ctx placeholder {0,0} would make normalCDF a step function
      // (stdDev=0) and produce phantom signals with edge≈1 on low-target
      // `or_below` buckets, which would then shadow highest-yes (edge=0).
      if (!forecast && strategy.id !== WEATHER_HIGHEST_YES_STRATEGY_ID) {
        abstainReasons.push(`${strategy.id}:forecast_unavailable`);
        if (evalLogEnabled && this.evaluationRecorder) {
          for (const bucket of activeBuckets) {
            const prices = resolveBucketPrices(bucket.market);
            evaluationInputs.push({
              snapshotId,
              conditionId: bucket.conditionId,
              bucketComparison: bucket.parsed.comparison,
              bucketTarget: bucket.parsed.targetValue,
              bucketLow: bucket.parsed.targetValueLow,
              bucketHigh: bucket.parsed.targetValueHigh,
              strategyId: strategy.id,
              yesPrice: prices.yesPrice,
              forecastProb: null,
              edge: null,
              dynamicMinEdge: null,
              decision: 'abstain',
              reason: 'forecast_unavailable',
            });
          }
        }
        continue;
      }
      if (strategy.evaluateGroup) {
        result = await strategy.evaluateGroup(activeMarkets, ctx);
        if (evalLogEnabled && this.evaluationRecorder) {
          for (const bucket of activeBuckets) {
            const perBucket =
              result.kind === 'signal' &&
              result.signal.conditionId === bucket.conditionId
                ? result
                : await strategy.evaluate(bucket.market, ctx);
            const prices = resolveBucketPrices(bucket.market);
            evaluationInputs.push({
              snapshotId,
              conditionId: bucket.conditionId,
              bucketComparison: bucket.parsed.comparison,
              bucketTarget: bucket.parsed.targetValue,
              bucketLow: bucket.parsed.targetValueLow,
              bucketHigh: bucket.parsed.targetValueHigh,
              strategyId: strategy.id,
              yesPrice: prices.yesPrice,
              forecastProb:
                perBucket.kind === 'signal'
                  ? perBucket.signal.forecastProbability
                  : (perBucket.forecastProb ?? null),
              edge:
                perBucket.kind === 'signal' ? perBucket.signal.edge : (perBucket.edge ?? null),
              dynamicMinEdge:
                perBucket.kind === 'signal'
                  ? perBucket.signal.dynamicMinEdge
                  : (perBucket.dynamicMinEdge ?? null),
              decision: perBucket.kind === 'signal' ? 'signal' : 'abstain',
              reason: perBucket.kind === 'abstain' ? perBucket.reason : null,
            });
          }
        }
      } else {
        for (const bucket of activeBuckets) {
          result = await strategy.evaluate(bucket.market, ctx);
          if (evalLogEnabled && this.evaluationRecorder) {
            const prices = resolveBucketPrices(bucket.market);
            evaluationInputs.push({
              snapshotId,
              conditionId: bucket.conditionId,
              bucketComparison: bucket.parsed.comparison,
              bucketTarget: bucket.parsed.targetValue,
              bucketLow: bucket.parsed.targetValueLow,
              bucketHigh: bucket.parsed.targetValueHigh,
              strategyId: strategy.id,
              yesPrice: prices.yesPrice,
              forecastProb:
                result.kind === 'signal'
                  ? result.signal.forecastProbability
                  : (result.forecastProb ?? null),
              edge:
                result.kind === 'signal' ? result.signal.edge : (result.edge ?? null),
              dynamicMinEdge:
                result.kind === 'signal'
                  ? result.signal.dynamicMinEdge
                  : (result.dynamicMinEdge ?? null),
              decision: result.kind === 'signal' ? 'signal' : 'abstain',
              reason: result.kind === 'abstain' ? result.reason : null,
            });
          }
          if (result.kind === 'signal') break;
          abstainReasons.push(`${bucket.parsed.comparison}:${result.reason}`);
        }
      }

      if (result.kind === 'signal') {
        if (evalLogEnabled && this.evaluationRecorder && evaluationInputs.length > 0) {
          try {
            await this.evaluationRecorder.recordBatch(evaluationInputs);
          } catch (err) {
            log.warn({ err, city, dateKey }, 'evaluation log batch failed — continuing');
          }
        }
        log.info(
          {
            city,
            dateKey,
            strategyId: strategy.id,
            forecastMean: forecast?.forecastMean,
            conditionId: result.signal.conditionId,
            edge: result.signal.edge,
          },
          'city-follow: strategy emitted signal',
        );
        return result.signal;
      }

      abstainReasons.push(`${strategy.id}:${result.reason}`);
    }

    if (evalLogEnabled && this.evaluationRecorder && evaluationInputs.length > 0) {
      try {
        await this.evaluationRecorder.recordBatch(evaluationInputs);
      } catch (err) {
        log.warn({ err, city, dateKey }, 'evaluation log batch failed — continuing');
      }
    }

    log.debug(
      { city, dateKey, bucketCount: activeBuckets.length, abstainReasons },
      'city-follow: no strategy signal',
    );
    return null;
  }

  private async publishStatus(status: {
    evaluableSelections: number;
    lastEvaluatedAt: number | null;
    lastSkipReason: string | null;
    lastSkipAt: number | null;
    activeStrategies: string[];
  }): Promise<void> {
    if (!this.runtimeStatus) return;
    try {
      await this.runtimeStatus.publish(status);
    } catch (err) {
      log.warn({ err }, 'failed to publish runtime status');
    }
  }
}



/**
 * Merge active and resolved buckets into the set to persist in a market snapshot.
 * Deduplicates by conditionId, keeping the active version when a bucket appears in
 * both (e.g. Gamma lag where a bucket is still closed:false in the live discovery
 * and closed:true in the resolved discovery). The resolved version only contributes
 * when it is no longer present in the active set.
 */
export function mergeBucketsForSnapshot(
  active: BucketCandidate[],
  resolved: BucketCandidate[],
): BucketCandidate[] {
  const seen = new Set(active.map((b) => b.market.conditionId));
  const merged = [...active];
  for (const r of resolved) {
    if (!seen.has(r.market.conditionId)) {
      merged.push(r);
      seen.add(r.market.conditionId);
    }
  }
  return merged;
}

