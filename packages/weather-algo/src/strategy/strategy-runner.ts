import pino from 'pino';
import { In, type DataSource } from 'typeorm';
import type { Redis } from 'ioredis';
import {
  type MarketListItemDto,
  type WeatherConfig,
  type WeatherMarketSelectionService,
  type WeatherForecastService,
  type WeatherAutoTrackService,
  type WeatherAutoTrackRule,
  type ParsedWeatherQuestion,
  CopiedPosition,
  WeatherPositionForecast,
  discoverWeatherMarkets,
  safeInterval,
  parseWeatherQuestion,
  normalizeWeatherCity,
  buildLookAheadTargetDates,
  selectForecastAlignedBucket,
  type BucketCandidate,
} from '@polywatch/core';
import { WeatherForecastStrategy } from './weather-forecast.strategy.js';
import type { WeatherStrategyRegistry } from './registry.js';
import type { WeatherSignal, WeatherStrategy } from './strategy.js';
import { WeatherAlgoRuntimeStatusPublisher } from '../runtime-status.js';
import type { WeatherExitEvaluator } from '../processors/weather-exit-evaluator.js';
import { WEATHER_FORECAST_CACHE_TTL_MS_DEFAULT } from '../config.js';

const log = pino({ name: 'weather-algo:strategy-runner' });

export interface StrategyRunnerParams {
  ds: DataSource;
  /** @deprecated Expand selections retired; kept for wiring compatibility. */
  selectionService: WeatherMarketSelectionService;
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
  private readonly ds: DataSource;
  private readonly selectionService: WeatherMarketSelectionService; // retained for API compat; unused in city-first path
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
    this.selectionService = params.selectionService;
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
    if (risk.weatherAlgoPollMs && risk.weatherAlgoPollMs > 0) {
      this.pollMs = risk.weatherAlgoPollMs;
    }
    for (const strategy of this.registry.getAll()) {
      if (strategy instanceof WeatherForecastStrategy) {
        strategy.setMinEdge(risk.weatherAlgoMinEdge);
        strategy.setMaxForecastStd(risk.weatherAlgoMaxForecastStd);
        strategy.setYesOnly(true);
      }
    }
  }

  start(): void {
    if (this.timer) return;
    log.info({ pollMs: this.pollMs }, 'weather strategy runner started');
    this.timer = safeInterval(
      () => this.runEvaluationCycle().catch((err) =>
        log.error({ err }, 'weather strategy evaluation cycle failed'),
      ),
      this.pollMs,
      'weather-algo:strategy-runner',
    );
    void this.runEvaluationCycle().catch((err) =>
      log.error({ err }, 'weather strategy initial evaluation failed'),
    );
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
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

      const discovery = await discoverWeatherMarkets({ limit: 100 });
      const minHoursToClose = this.risk.weatherAlgoCloseBeforeResolutionHours ?? 1;
      const openCities = await this.loadOpenWeatherCities();

      log.info({ ruleCount: cityFollowRules.length, openCities: [...openCities] }, 'evaluating city-follow rules');

      const allSignals = await this.evaluateCityFollowRules(
        cityFollowRules,
        discovery.temperatureMarkets,
        minHoursToClose,
        openCities,
      );

      const selectedSignals = this.applySelectionMode(allSignals);

      // Enforce one open position per city across the emitted batch
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
   */
  private async loadOpenWeatherCities(): Promise<Set<string>> {
    const positions = await this.ds.getRepository(CopiedPosition).find({
      where: {
        reason: 'WEATHER_OPEN',
        status: In(['pending', 'open', 'closing']),
      },
    });
    const active = positions.filter(
      (p) => p.status === 'pending' || p.status === 'closing' || p.quantity > 0,
    );
    if (active.length === 0) return new Set();

    const cities = new Set<string>();
    const forecastRepo = this.ds.getRepository(WeatherPositionForecast);
    const ids = active.map((p) => p.id);
    const snaps = await forecastRepo.find({
      where: { copiedPositionId: In(ids) },
    });
    for (const snap of snaps) {
      if (snap.city) cities.add(normalizeWeatherCity(snap.city));
    }
    return cities;
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

      const targetMonthDays = new Set(
        [...targetDateStrs].map((dateStr) => {
          const d = new Date(`${dateStr}T12:00:00Z`);
          return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
        }),
      );

      const metric = (rule.metric || 'highest_temp') as 'highest_temp' | 'lowest_temp';
      const matching: Array<{ market: MarketListItemDto; parsed: ParsedWeatherQuestion }> = [];
      for (const market of temperatureMarkets) {
        if (!market.question) continue;
        const parsed = parseWeatherQuestion(market.question);
        if (!parsed) continue;
        if (normalizeWeatherCity(parsed.city) !== cityKey) continue;
        if (parsed.metric !== metric) continue;

        const dateMatch = targetMonthDays.has(parsed.dateString) ||
          (market.endDate ? targetDateStrs.has(new Date(market.endDate).toISOString().slice(0, 10)) : false);
        if (!dateMatch) continue;

        matching.push({ market, parsed });
      }

      if (matching.length === 0) {
        log.debug({ city: rule.city, metric }, 'city-follow: no matching markets found');
        continue;
      }

      const byDate = new Map<string, MarketListItemDto[]>();
      for (const { market, parsed } of matching) {
        const dateKey: string = market.endDate
          ? new Date(market.endDate).toISOString().slice(0, 10)
          : parsed.dateString;
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
      log.debug({ city, dateKey }, 'city-follow: no active markets');
      return null;
    }

    const selected = selectForecastAlignedBucket(forecast.forecastMean, buckets);
    if (!selected) {
      log.debug(
        { city, dateKey, forecastMean: forecast.forecastMean },
        'city-follow: no bucket aligned with forecast',
      );
      return null;
    }

    log.info(
      {
        city,
        dateKey,
        forecastMean: forecast.forecastMean,
        conditionId: selected.conditionId,
        comparison: selected.parsed.comparison,
        target: selected.parsed.targetValue ?? `${selected.parsed.targetValueLow}-${selected.parsed.targetValueHigh}`,
      },
      'city-follow: selected bucket aligned with forecast',
    );

    const ctx = {
      forecastMean: forecast.forecastMean,
      forecastStdDev: forecast.forecastStdDev,
      tempDistribution: new Map<number, number>(),
    };

    for (const strategy of strategies) {
      const result = await strategy.evaluate(selected.market, ctx);
      if (result.kind === 'signal') {
        return result.signal;
      }
    }

    return null;
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

    let mode = this.risk.weatherAlgoSelectionMode ?? 'single';
    if (mode === 'spread') {
      log.info('weather selection mode spread ignored in city-first — using single');
      mode = 'single';
    }

    if (mode === 'single') {
      const best = signals.reduce((a, b) => (b.edge > a.edge ? b : a));
      return [best];
    }

    if (mode === 'multi') {
      const maxN = this.risk.weatherAlgoMaxSignalsPerEvent ?? 3;
      const sorted = [...signals].sort((a, b) => b.edge - a.edge);
      const seen = new Set<string>();
      const selected: WeatherSignal[] = [];
      for (const sig of sorted) {
        const key = normalizeWeatherCity(sig.city);
        if (seen.has(key)) continue;
        seen.add(key);
        selected.push(sig);
        if (selected.length >= maxN) break;
      }
      return selected;
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
  if (market.endDate) {
    const end = new Date(market.endDate).getTime();
    const minMs = Math.max(0, minHoursToClose) * 3_600_000;
    if (end - Date.now() < minMs) return false;
  }
  return true;
}
