import pino from 'pino';
import type { DataSource } from 'typeorm';
import type { Redis } from 'ioredis';
import {
  type MarketListItemDto,
  type RiskConfig,
  type WeatherMarketSelection,
  type WeatherMarketSelectionService,
  type WeatherForecastService,
  type WeatherAutoTrackService,
  type WeatherAutoTrackRule,
  type ParsedWeatherQuestion,
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

interface EventGroup {
  eventSlug: string;
  selections: WeatherMarketSelection[];
}

export class WeatherStrategyRunner {
  private timer: NodeJS.Timeout | null = null;
  private readonly ds: DataSource;
  private readonly selectionService: WeatherMarketSelectionService;
  private readonly autoTrackService: WeatherAutoTrackService;
  private readonly forecastService: WeatherForecastService;
  private readonly registry: WeatherStrategyRegistry;
  private readonly redisCmd: Redis;
  private readonly onSignal: (signal: WeatherSignal) => Promise<boolean>;
  private pollMs: number;
  private readonly forecastCacheTtlMs: number;
  private risk: RiskConfig | null = null;
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

  setRiskConfig(risk: RiskConfig): void {
    this.risk = risk;
    if (risk.weatherAlgoPollMs && risk.weatherAlgoPollMs > 0) {
      this.pollMs = risk.weatherAlgoPollMs;
    }
    // Propagate minEdge and maxForecastStd to the forecast strategy
    for (const strategy of this.registry.getAll()) {
      if (strategy instanceof WeatherForecastStrategy) {
        strategy.setMinEdge(risk.weatherAlgoMinEdge);
        strategy.setMaxForecastStd(risk.weatherAlgoMaxForecastStd);
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
    // Run immediately on start
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

      if (this.risk.weatherAlgoEnabled) {
        const selections = await this.selectionService.loadAllEnabled();
        status.evaluableSelections = selections.length;

        // Single discovery snapshot shared between expand and city-follow paths
        const discovery = await discoverWeatherMarkets({ limit: 100 });
        const marketByConditionId = new Map<string, MarketListItemDto>();
        for (const m of discovery.temperatureMarkets) {
          marketByConditionId.set(m.conditionId, m);
        }

        const minHoursToClose = this.risk.weatherAlgoCloseBeforeResolutionHours ?? 1;
        const allSignals: WeatherSignal[] = [];

        // --- Path 1: Expand selections (existing behaviour) ---
        if (selections.length > 0) {
          const groups = this.groupSelectionsByEvent(selections, marketByConditionId);
          log.info(
            {
              eventCount: groups.length,
              totalSelections: selections.length,
              marketsFound: marketByConditionId.size,
            },
            'evaluating weather markets (expand)',
          );

          for (const group of groups) {
            try {
              const signals = await this.evaluateEventGroup(group, marketByConditionId, minHoursToClose);
              allSignals.push(...signals);
            } catch (err) {
              log.error({ err, eventSlug: group.eventSlug }, 'failed to evaluate event group');
            }
          }
        }

        // --- Path 2: City-follow rules ---
        const cityFollowRules = await this.loadCityFollowRules();
        if (cityFollowRules.length > 0) {
          log.info({ ruleCount: cityFollowRules.length }, 'evaluating city-follow rules');
          const citySignals = await this.evaluateCityFollowRules(
            cityFollowRules,
            discovery.temperatureMarkets,
            minHoursToClose,
          );
          allSignals.push(...citySignals);
        }

        // Apply selection mode across all signals
        const selectedSignals = this.applySelectionMode(allSignals);

        // Emit signals
        for (const signal of selectedSignals) {
          try {
            const accepted = await this.onSignal(signal);
            if (accepted) {
              log.info(
                { conditionId: signal.conditionId, eventSlug: signal.eventSlug, edge: signal.edge },
                'weather signal accepted',
              );
            }
          } catch (err) {
            log.error({ err, conditionId: signal.conditionId }, 'weather signal dispatch failed');
          }
        }

        status.lastEvaluatedAt = Date.now();
      } else {
        status.lastSkipReason = 'disabled';
        status.lastSkipAt = Date.now();
        log.debug('weather-algo disabled — skipping entry evaluation');
      }
    } catch (err) {
      log.error({ err }, 'weather strategy evaluation cycle failed');
      status.lastSkipReason = 'cycle_error';
      status.lastSkipAt = Date.now();
    } finally {
      if (this.exitEvaluator && this.risk) {
        try {
          await this.exitEvaluator.evaluateOpenPositions();
        } catch (err) {
          log.error({ err }, 'weather exit evaluation failed');
        }
      }
      await this.publishStatus(status);
    }
  }

  private async loadCityFollowRules(): Promise<WeatherAutoTrackRule[]> {
    const all = await this.autoTrackService.loadAllEnabled();
    return all.filter((r) => r.mode === 'city_follow');
  }

  /**
   * Evaluate city-follow rules: for each rule, find the forecast-aligned bucket
   * and emit a single BUY YES signal if edge clears the threshold.
   */
  private async evaluateCityFollowRules(
    rules: WeatherAutoTrackRule[],
    temperatureMarkets: MarketListItemDto[],
    minHoursToClose: number,
  ): Promise<WeatherSignal[]> {
    const signals: WeatherSignal[] = [];
    const strategies = this.registry.getAll();

    for (const rule of rules) {
      const targetDates = buildLookAheadTargetDates(rule.lookAheadDays ?? 1);
      const targetDateStrs = new Set(
        targetDates.map((d) => d.toISOString().slice(0, 10)),
      );

      // Build target month-day strings for question date matching
      const targetMonthDays = new Set(
        [...targetDateStrs].map((dateStr) => {
          const d = new Date(`${dateStr}T12:00:00Z`);
          return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
        }),
      );

      // Filter markets matching this rule, storing parsed result to avoid double-parse
      const matching: Array<{ market: MarketListItemDto; parsed: ParsedWeatherQuestion }> = [];
      for (const market of temperatureMarkets) {
        if (!market.question) continue;
        const parsed = parseWeatherQuestion(market.question);
        if (!parsed) continue;
        if (normalizeWeatherCity(parsed.city) !== normalizeWeatherCity(rule.city)) continue;
        if (parsed.metric !== rule.metric) continue;

        // Date matching: question dateString or endDate
        const dateMatch = targetMonthDays.has(parsed.dateString) ||
          (market.endDate ? targetDateStrs.has(new Date(market.endDate).toISOString().slice(0, 10)) : false);
        if (!dateMatch) continue;

        matching.push({ market, parsed });
      }

      if (matching.length === 0) {
        log.debug({ city: rule.city, metric: rule.metric }, 'city-follow: no matching markets found');
        continue;
      }

      // Group by target date (each date = one event)
      const byDate = new Map<string, MarketListItemDto[]>();
      for (const { market, parsed } of matching) {
        const dateKey: string = market.endDate
          ? new Date(market.endDate).toISOString().slice(0, 10)
          : parsed.dateString;
        const arr = byDate.get(dateKey);
        if (arr) arr.push(market);
        else byDate.set(dateKey, [market]);
      }

      for (const [dateKey, markets] of byDate) {
        try {
          const signal = await this.evaluateCityFollowDateGroup(
            rule.city,
            rule.metric as 'highest_temp' | 'lowest_temp',
            dateKey,
            markets,
            strategies,
            minHoursToClose,
          );
          if (signal) signals.push(signal);
        } catch (err) {
          log.error({ err, city: rule.city, dateKey }, 'city-follow date group evaluation failed');
        }
      }
    }

    return signals;
  }

  /**
   * For a single city+metric+date group, fetch forecast, select aligned bucket,
   * evaluate edge, and return a signal if eligible.
   */
  private async evaluateCityFollowDateGroup(
    city: string,
    metric: 'highest_temp' | 'lowest_temp',
    dateKey: string,
    markets: MarketListItemDto[],
    strategies: WeatherStrategy[],
    minHoursToClose: number,
  ): Promise<WeatherSignal | null> {
    // Resolve target date
    const targetDate = new Date(`${dateKey}T12:00:00Z`);

    // Fetch forecast (cache or Open-Meteo)
    const forecast = await this.forecastService.getOrFetch(city, targetDate, metric, this.forecastCacheTtlMs);
    if (!forecast) {
      log.warn({ city, targetDate, metric }, 'city-follow: forecast unavailable — skipping');
      return null;
    }

    // Build bucket candidates
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

    // Select forecast-aligned bucket
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

    // Evaluate edge on the selected bucket
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

  private groupSelectionsByEvent(
    selections: WeatherMarketSelection[],
    marketByConditionId: Map<string, MarketListItemDto>,
  ): EventGroup[] {
    const map = new Map<string, WeatherMarketSelection[]>();
    for (const sel of selections) {
      const market = marketByConditionId.get(sel.conditionId);
      const key = sel.eventSlug ?? market?.eventSlug ?? sel.conditionId;
      const arr = map.get(key);
      if (arr) arr.push(sel);
      else map.set(key, [sel]);
    }
    return Array.from(map.entries()).map(([eventSlug, sels]) => ({ eventSlug, selections: sels }));
  }

  private async evaluateEventGroup(
    group: EventGroup,
    marketByConditionId: Map<string, MarketListItemDto>,
    minHoursToClose: number,
  ): Promise<WeatherSignal[]> {
    if (group.selections.length === 0) return [];

    const first = group.selections[0]!;
    if (!first.city || !first.metric) {
      log.warn({ eventSlug: group.eventSlug }, 'missing city or metric — skipping event');
      return [];
    }

    const targetDate = first.targetDate ?? new Date();
    const metric = first.metric as 'highest_temp' | 'lowest_temp';

    const forecast = await this.forecastService.getOrFetch(first.city, targetDate, metric, this.forecastCacheTtlMs);
    if (!forecast) {
      log.warn({ city: first.city, targetDate }, 'forecast unavailable — skipping event');
      return [];
    }

    const ctx = {
      forecastMean: forecast.forecastMean,
      forecastStdDev: forecast.forecastStdDev,
      tempDistribution: new Map<number, number>(),
    };

    const strategies = this.registry.getAll();
    const allSignals: WeatherSignal[] = [];

    for (const sel of group.selections) {
      const market = marketByConditionId.get(sel.conditionId);
      if (!market) {
        log.warn({ conditionId: sel.conditionId }, 'market not found in discovery snapshot — skipping');
        continue;
      }

      if (!isMarketActiveForWeather(market, minHoursToClose)) {
        log.debug({ conditionId: sel.conditionId }, 'market not active — skipping');
        continue;
      }

      for (const strategy of strategies) {
        const result = await strategy.evaluate(market, ctx);
        if (result.kind === 'signal') {
          allSignals.push(result.signal);
        }
      }
    }

    return allSignals;
  }

  private applySelectionMode(signals: WeatherSignal[]): WeatherSignal[] {
    if (signals.length === 0) return [];
    if (!this.risk) return signals;

    const mode = this.risk.weatherAlgoSelectionMode ?? 'single';

    if (mode === 'single') {
      const best = signals.reduce((a, b) => (Math.abs(b.edge) > Math.abs(a.edge) ? b : a));
      return [best];
    }

    if (mode === 'multi') {
      const maxN = this.risk.weatherAlgoMaxSignalsPerEvent ?? 3;
      const sorted = [...signals].sort((a, b) => Math.abs(b.edge) - Math.abs(a.edge));
      const seen = new Set<string>();
      const selected: WeatherSignal[] = [];
      for (const sig of sorted) {
        const key = `${sig.eventSlug}:${sig.outcome}`;
        if (seen.has(key)) continue;
        seen.add(key);
        selected.push(sig);
        if (selected.length >= maxN) break;
      }
      return selected;
    }

    if (mode === 'spread') {
      // Spread mode: select the best YES and best NO signal regardless of edge threshold.
      // This is a coverage strategy (not edge-hunting) — it takes both sides even if edge ≈ 0,
      // to capture the spread between market price and forecast probability on both outcomes.
      const yesSignals = signals.filter((s) => s.outcome === 'YES');
      const noSignals = signals.filter((s) => s.outcome === 'NO');
      const selected: WeatherSignal[] = [];

      if (yesSignals.length > 0) {
        const bestYes = yesSignals.reduce((a, b) => (b.edge > a.edge ? b : a));
        selected.push(bestYes);
      }
      if (noSignals.length > 0) {
        const bestNo = noSignals.reduce((a, b) => (b.edge > a.edge ? b : a));
        selected.push(bestNo);
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
