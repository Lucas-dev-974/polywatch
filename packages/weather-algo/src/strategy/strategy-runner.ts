import pino from 'pino';
import { In, MoreThanOrEqual, type DataSource } from 'typeorm';
import type { Redis } from 'ioredis';
import {
  type MarketListItemDto,
  type WeatherConfig,
  type WeatherForecastService,
  type WeatherAutoTrackService,
  type WeatherAutoTrackRule,
  CopiedPosition,
  WeatherPositionForecast,
  PositionReservation,
  discoverWeatherMarkets,
  safeInterval,
  parseWeatherQuestion,
  normalizeWeatherCity,
  buildLookAheadTargetDates,
  resolveMarketTargetDateIso,
  type BucketCandidate,
} from '@polywatch/core';
import type { WeatherStrategyRegistry } from './registry.js';
import type { WeatherSignal, WeatherStrategy } from './strategy.js';
import { WeatherAlgoRuntimeStatusPublisher } from '../runtime-status.js';
import type { WeatherExitEvaluator } from '../processors/weather-exit-evaluator.js';
import { WEATHER_FORECAST_CACHE_TTL_MS_DEFAULT } from '../config.js';
import { DEFAULT_MAX_SIGNALS_PER_EVENT } from '../constants.js';

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
      strategy.setRiskConfig?.(risk);
    }
  }

  /** Start interval + run one evaluation cycle (boot). */
  start(): void {
    if (this.timer) return;
    this.stopped = false;
    this.pendingRerun = false;
    log.info({ pollMs: this.pollMs }, 'weather strategy runner started');
    this.startTimer();
    this.requestEvaluationCycle();
  }

  stop(): void {
    this.stopped = true;
    this.pendingRerun = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Recreate the poll timer with the current pollMs. Does not trigger an
   * evaluation cycle (caller is responsible for requestEvaluationCycle).
   */
  restartPolling(): void {
    if (this.stopped) return;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    log.info({ pollMs: this.pollMs }, 'weather strategy runner poll restarted');
    this.startTimer();
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

  private startTimer(): void {
    if (this.timer || this.stopped) return;
    this.timer = safeInterval(
      () => this.runEvaluationCycleGuarded(),
      this.pollMs,
      'weather-algo:strategy-runner',
    );
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
    };

    try {
      if (!this.risk) {
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

      if (!this.risk.weatherAlgoEnabled) {
        status.lastSkipReason = 'disabled';
        status.lastSkipAt = Date.now();
        log.debug('weather-algo disabled — skipping entry evaluation');
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
      const minHoursToClose = this.risk.weatherAlgoCloseBeforeResolutionHours ?? 1;
      const openCities = await this.loadOpenWeatherCities();

      log.info(
        {
          ruleCount: cityFollowRules.length,
          openCities: [...openCities],
          maxLookAhead,
          targetDates: discoveryTargetDates.map((d) => d.toISOString().slice(0, 10)),
        },
        'evaluating city-follow rules',
      );

      const allSignals = await this.evaluateCityFollowRules(
        cityFollowRules,
        discovery.temperatureMarkets,
        minHoursToClose,
        openCities,
      );

      // Deduplicate signals by city before selection: when several rules target
      // the same city (e.g. highest_temp + lowest_temp), keep only the best-edge
      // signal per city so applySelectionMode's slice doesn't waste a slot on a
      // same-city duplicate that seenCities would filter out afterwards.
      const dedupedSignals = dedupSignalsByCity(allSignals);

      const selectedSignals = this.applySelectionMode(dedupedSignals);

      // Safety guard: enforce one open position per city across the emitted
      // batch. dedupedSignals already carries at most one signal per city, but
      // seenCities also blocks cities that already have an open/pending position
      // (defensive against any upstream regression in the open-city filter).
      const seenCities = new Set<string>(openCities);
      for (const signal of selectedSignals) {
        const cityKey = normalizeWeatherCity(signal.city);
        if (seenCities.has(cityKey)) {
          log.debug({ city: signal.city, conditionId: signal.conditionId }, 'skip signal — city already has open/pending position');
          continue;
        }
        try {
          const accepted = await this.onSignal(signal);
          if (accepted) {
            seenCities.add(cityKey);
            log.info(
              { conditionId: signal.conditionId, eventSlug: signal.eventSlug, edge: signal.edge, city: signal.city },
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
   * Cities that already have a WEATHER_OPEN position in flight or open.
   * Includes pending (reserved, not filled) and closing (exit enqueued / in progress)
   * so we never open a second thesis for the same city.
   *
   * A pending position with quantity 0 is only considered active when it has a
   * non-expired reservation. Otherwise it is a stale zombie left by an earlier
   * failed entry and must not block the city.
   */
  private async loadOpenWeatherCities(): Promise<Set<string>> {
    const positions = await this.ds.getRepository(CopiedPosition).find({
      where: {
        reason: 'WEATHER_OPEN',
        status: In(['pending', 'open', 'closing']),
      },
    });
    if (positions.length === 0) return new Set();

    const activeIds = await this.resolveActiveWeatherPositionIds(positions);
    if (activeIds.size === 0) return new Set();

    const cities = new Set<string>();
    const snaps = await this.ds.getRepository(WeatherPositionForecast).find({
      where: { copiedPositionId: In([...activeIds]) },
    });
    for (const snap of snaps) {
      if (snap.city) cities.add(normalizeWeatherCity(snap.city));
    }
    return cities;
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
    minHoursToClose: number,
    openCities: Set<string>,
  ): Promise<WeatherSignal[]> {
    const signals: WeatherSignal[] = [];
    const strategies = this.registry.getAll();

    for (const rule of rules) {
      const cityKey = normalizeWeatherCity(rule.city);
      if (openCities.has(cityKey)) {
        log.debug({ city: rule.city }, 'city-follow: skip — open position already exists for city');
        continue;
      }

      const targetDates = buildLookAheadTargetDates(rule.lookAheadDays ?? 1);
      const targetDateStrs = new Set(
        targetDates.map((d) => d.toISOString().slice(0, 10)),
      );

      const metric = (rule.metric || 'highest_temp') as 'highest_temp' | 'lowest_temp';
      const matching: Array<{ market: MarketListItemDto; dateKey: string }> = [];
      for (const market of temperatureMarkets) {
        if (!market.question) continue;
        const parsed = parseWeatherQuestion(market.question);
        if (!parsed) continue;
        if (normalizeWeatherCity(parsed.city) !== cityKey) continue;
        if (parsed.metric !== metric) continue;

        const dateKey = resolveMarketTargetDateIso(market);
        if (!dateKey || !targetDateStrs.has(dateKey)) continue;

        matching.push({ market, dateKey });
      }

      if (matching.length === 0) {
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

      const citySignals: WeatherSignal[] = [];
      for (const [dateKey, markets] of byDate) {
        try {
          const signal = await this.evaluateCityFollowDateGroup(
            rule.city,
            metric,
            dateKey,
            markets,
            strategies,
            minHoursToClose,
          );
          if (signal) citySignals.push(signal);
        } catch (err) {
          log.error({ err, city: rule.city, dateKey }, 'city-follow date group evaluation failed');
        }
      }

      // At most one candidate per city (best YES edge among look-ahead dates)
      if (citySignals.length > 0) {
        const best = citySignals.reduce((a, b) => (b.edge > a.edge ? b : a));
        signals.push(best);
      }
    }

    return signals;
  }

  private async evaluateCityFollowDateGroup(
    city: string,
    metric: 'highest_temp' | 'lowest_temp',
    dateKey: string,
    markets: MarketListItemDto[],
    strategies: WeatherStrategy[],
    minHoursToClose: number,
  ): Promise<WeatherSignal | null> {
    const targetDate = new Date(`${dateKey}T12:00:00Z`);
    if (Number.isNaN(targetDate.getTime())) {
      log.warn({ city, dateKey, metric }, 'city-follow: invalid dateKey — skipping');
      return null;
    }

    const forecast = await this.forecastService.getOrFetch(city, targetDate, metric, this.forecastCacheTtlMs);
    if (!forecast) {
      log.warn({ city, targetDate, metric }, 'city-follow: forecast unavailable — skipping');
      return null;
    }

    const buckets: BucketCandidate[] = [];
    for (const market of markets) {
      if (!isMarketActiveForWeather(market, minHoursToClose)) continue;
      const q = market.question;
      if (!q) continue;
      const parsed = parseWeatherQuestion(q);
      if (!parsed) continue;
      buckets.push({ conditionId: market.conditionId, market, parsed });
    }

    if (buckets.length === 0) {
      log.debug({ city, dateKey, marketCount: markets.length }, 'city-follow: no active markets');
      return null;
    }

    const ctx = {
      forecastMean: forecast.forecastMean,
      forecastStdDev: forecast.forecastStdDev,
    };

    const candidates: WeatherSignal[] = [];
    const abstainReasons: string[] = [];
    for (const bucket of buckets) {
      for (const strategy of strategies) {
        const result = await strategy.evaluate(bucket.market, ctx);
        if (result.kind === 'signal') {
          candidates.push(result.signal);
          break;
        } else {
          abstainReasons.push(`${bucket.parsed.comparison}:${result.reason}`);
        }
      }
    }

    if (candidates.length === 0) {
      log.debug({ city, dateKey, bucketCount: buckets.length, abstainReasons }, 'city-follow: no bucket with sufficient edge');
      return null;
    }

    const best = pickBestEdgeBucket(candidates, forecast.forecastMean);
    log.info(
      {
        city,
        dateKey,
        forecastMean: forecast.forecastMean,
        conditionId: best.conditionId,
        comparison: best.entryBucketComparison,
        target: best.entryBucketBounds?.target ??
          `${best.entryBucketBounds?.low ?? ''}-${best.entryBucketBounds?.high ?? ''}`,
        edge: best.edge,
        nCandidates: candidates.length,
      },
      'city-follow: best-edge bucket selected',
    );

    return best;
  }

  private async publishStatus(status: {
    evaluableSelections: number;
    lastEvaluatedAt: number | null;
    lastSkipReason: string | null;
    lastSkipAt: number | null;
  }): Promise<void> {
    if (!this.runtimeStatus) return;
    try {
      await this.runtimeStatus.publish(status);
    } catch (err) {
      log.warn({ err }, 'failed to publish runtime status');
    }
  }

  private applySelectionMode(signals: WeatherSignal[]): WeatherSignal[] {
    if (signals.length === 0) return [];
    if (!this.risk) return signals;

    const mode = this.risk.weatherAlgoSelectionMode ?? 'single';

    if (mode === 'single') {
      const best = signals.reduce((a, b) => (b.edge > a.edge ? b : a));
      return [best];
    }

    if (mode === 'multi') {
      // The 1-per-city guarantee is enforced upstream by `dedupSignalsByCity`
      // (called in runEvaluationCycle before selection) which keeps only the
      // best-edge signal per city. No city dedup is needed here.
      const maxN = this.risk.weatherAlgoMaxSignalsPerEvent ?? DEFAULT_MAX_SIGNALS_PER_EVENT;
      const sorted = [...signals].sort((a, b) => b.edge - a.edge);
      return sorted.slice(0, maxN);
    }

    return signals;
  }
}

function isMarketActiveForWeather(
  market: MarketListItemDto,
  minHoursToClose: number,
): boolean {
  if (market.closed) return false;
  if (market.acceptingOrders === false) return false;
  // Weather markets must be CLOB-tradable: a YES token id is required for
  // execution, otherwise the worker will cancel the order with no fill.
  if (!market.tokenIdYes) return false;
  if (market.endDate) {
    const end = new Date(market.endDate).getTime();
    const minMs = Math.max(0, minHoursToClose) * 3_600_000;
    if (end - Date.now() < minMs) return false;
  }
  return true;
}

/**
 * Deduplicate weather signals by city, keeping only the highest-edge signal per
 * normalized city. This runs in `runEvaluationCycle` before `applySelectionMode`
 * so that several rules targeting the same city (e.g. highest_temp + lowest_temp)
 * cannot consume more than one selection slot.
 */
export function dedupSignalsByCity(signals: WeatherSignal[]): WeatherSignal[] {
  const bestPerCity = new Map<string, WeatherSignal>();
  for (const signal of signals) {
    const cityKey = normalizeWeatherCity(signal.city);
    const prev = bestPerCity.get(cityKey);
    if (!prev || signal.edge > prev.edge) {
      bestPerCity.set(cityKey, signal);
    }
  }
  return [...bestPerCity.values()];
}

/**
 * Pick the bucket with the highest YES edge.
 * Callers must only pass non-empty candidate lists (all edges are assumed positive).
 * On exact edge ties, pick the bucket whose centre is closest to the forecast mean.
 *   - For exact / or_below / or_above buckets, the centre is the target value.
 *   - For between buckets, the centre is the midpoint of the bounds.
 */
export function pickBestEdgeBucket(
  candidates: WeatherSignal[],
  forecastMean: number,
): WeatherSignal {
  if (candidates.length === 0) {
    throw new Error('pickBestEdgeBucket called with empty candidates');
  }
  return candidates.reduce((best, current) => {
    if (current.edge > best.edge) return current;
    if (current.edge < best.edge) return best;
    // Tie on edge: pick the bucket closest to the forecast mean.
    const currentCentre = bucketCentre(current.entryBucketBounds, forecastMean);
    const bestCentre = bucketCentre(best.entryBucketBounds, forecastMean);
    const currentDist = Math.abs(forecastMean - currentCentre);
    const bestDist = Math.abs(forecastMean - bestCentre);
    return currentDist < bestDist ? current : best;
  });
}

export function bucketCentre(
  bounds: WeatherSignal['entryBucketBounds'],
  fallback: number,
): number {
  if (bounds?.target != null) return bounds.target;
  if (bounds?.low != null && bounds?.high != null) return (bounds.low + bounds.high) / 2;
  return fallback;
}
