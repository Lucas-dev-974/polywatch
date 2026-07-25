import pino from 'pino';
import type { DataSource } from 'typeorm';
import type { Redis } from 'ioredis';
import {
  type MarketListItemDto,
  type RiskConfig,
  type WeatherMarketSelection,
  type WeatherMarketSelectionService,
  type WeatherForecastService,
  fetchWeatherForecast,
  discoverWeatherMarkets,
  safeInterval,
} from '@polywatch/core';
import { WeatherForecastStrategy } from './weather-forecast.strategy.js';
import type { WeatherStrategyRegistry } from './registry.js';
import type { WeatherSignal } from './strategy.js';
import { WeatherAlgoRuntimeStatusPublisher } from '../runtime-status.js';

const log = pino({ name: 'weather-algo:strategy-runner' });

export interface StrategyRunnerParams {
  ds: DataSource;
  selectionService: WeatherMarketSelectionService;
  forecastService: WeatherForecastService;
  registry: WeatherStrategyRegistry;
  redisCmd: Redis;
  onSignal: (signal: WeatherSignal) => Promise<boolean>;
  pollMs: number;
  forecastCacheTtlMs?: number;
  runtimeStatus?: WeatherAlgoRuntimeStatusPublisher;
}

interface EventGroup {
  eventSlug: string;
  selections: WeatherMarketSelection[];
}

export class WeatherStrategyRunner {
  private timer: NodeJS.Timeout | null = null;
  private readonly ds: DataSource;
  private readonly selectionService: WeatherMarketSelectionService;
  private readonly forecastService: WeatherForecastService;
  private readonly registry: WeatherStrategyRegistry;
  private readonly redisCmd: Redis;
  private readonly onSignal: (signal: WeatherSignal) => Promise<boolean>;
  private pollMs: number;
  private readonly forecastCacheTtlMs: number;
  private risk: RiskConfig | null = null;
  private runtimeStatus?: WeatherAlgoRuntimeStatusPublisher;

  constructor(params: StrategyRunnerParams) {
    this.ds = params.ds;
    this.selectionService = params.selectionService;
    this.forecastService = params.forecastService;
    this.registry = params.registry;
    this.redisCmd = params.redisCmd;
    this.onSignal = params.onSignal;
    this.pollMs = params.pollMs;
    this.forecastCacheTtlMs = params.forecastCacheTtlMs ?? 3600_000;
    this.runtimeStatus = params.runtimeStatus;
  }

  setRiskConfig(risk: RiskConfig): void {
    this.risk = risk;
    if (risk.weatherAlgoPollMs && risk.weatherAlgoPollMs > 0) {
      this.pollMs = risk.weatherAlgoPollMs;
    }
    // Propagate minEdge and maxForecastStd to the forecast strategy
    // (BUG-1 fix: setMinEdge was never called; BUG-2 fix: maxForecastStd)
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
      if (!this.risk || !this.risk.weatherAlgoEnabled) {
        status.lastSkipReason = 'disabled';
        status.lastSkipAt = Date.now();
        await this.publishStatus(status);
        log.debug('weather-algo disabled — skipping evaluation cycle');
        return;
      }

      const selections = this.selectionService.loadAllEnabled
        ? await this.selectionService.loadAllEnabled()
        : [];

      status.evaluableSelections = selections.length;

      if (selections.length === 0) {
        status.lastSkipReason = 'no_selections';
        status.lastSkipAt = Date.now();
        await this.publishStatus(status);
        log.debug('no enabled weather selections — skipping cycle');
        return;
      }

      // Fetch fresh market snapshots with live prices from Polymarket.
      const discovery = await discoverWeatherMarkets({ limit: 500 });
      const marketByConditionId = new Map<string, MarketListItemDto>();
      for (const m of discovery.temperatureMarkets) {
        marketByConditionId.set(m.conditionId, m);
      }

      // Group selections by eventSlug (resolved from market data when DB eventSlug is null)
      const groups = this.groupSelectionsByEvent(selections, marketByConditionId);
      log.info(
        {
          eventCount: groups.length,
          totalSelections: selections.length,
          marketsFound: marketByConditionId.size,
        },
        'evaluating weather markets',
      );

      for (const group of groups) {
        try {
          await this.evaluateEventGroup(group, marketByConditionId);
        } catch (err) {
          log.error({ err, eventSlug: group.eventSlug }, 'failed to evaluate event group');
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
      // GHOST-5 fix: when sel.eventSlug is null, try to resolve from the
      // discovery market snapshot. Falls back to conditionId only if the
      // market is also missing or has no eventSlug.
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
  ): Promise<void> {
    if (group.selections.length === 0) return;

    // Use the first selection to determine city, metric, and target date
    const first = group.selections[0]!;
    if (!first.city || !first.metric) {
      log.warn({ eventSlug: group.eventSlug }, 'missing city or metric — skipping event');
      return;
    }

    const targetDate = first.targetDate ?? new Date();
    const metric = first.metric as 'highest_temp' | 'lowest_temp';

    // Check forecast cache first
    let forecast = await this.forecastService.getCached(first.city, targetDate, metric);

    // If no fresh cache, fetch from Open-Meteo
    if (!forecast || !forecast.isFresh) {
      log.info({ city: first.city, targetDate, metric }, 'fetching fresh weather forecast');
      const freshForecast = await fetchWeatherForecast(first.city, targetDate, metric);
      if (!freshForecast) {
        log.warn({ city: first.city, targetDate }, 'forecast fetch failed — skipping event');
        return;
      }

      const expiresAt = new Date(Date.now() + this.forecastCacheTtlMs);
      await this.forecastService.save({
        city: first.city,
        forecastDate: targetDate,
        metric,
        forecastMean: freshForecast.forecastMean,
        forecastStdDev: freshForecast.forecastStdDev,
        modelValues: freshForecast.modelValues,
        latitude: freshForecast.latitude,
        longitude: freshForecast.longitude,
        fetchedAt: new Date(),
        expiresAt,
        isFresh: true,
      });

      forecast = {
        city: first.city,
        forecastDate: targetDate,
        metric,
        forecastMean: freshForecast.forecastMean,
        forecastStdDev: freshForecast.forecastStdDev,
        modelValues: freshForecast.modelValues,
        latitude: freshForecast.latitude,
        longitude: freshForecast.longitude,
        fetchedAt: new Date(),
        expiresAt,
        isFresh: true,
      };
    }

    // Build probability distribution over all target temperatures in the group
    // (not used by the strategy directly — computeMarketImpliedProbabilities
    //  recalculates from forecastMean/stdDev. Kept for potential future use.)

    const ctx = {
      forecastMean: forecast.forecastMean,
      forecastStdDev: forecast.forecastStdDev,
      tempDistribution: new Map<number, number>(),
    };

    // Evaluate each sub-market with the shared forecast context
    const strategies = this.registry.getAll();
    const allSignals: WeatherSignal[] = [];

    for (const sel of group.selections) {
      const market = marketByConditionId.get(sel.conditionId);
      if (!market) {
        log.warn({ conditionId: sel.conditionId }, 'market not found in discovery snapshot — skipping');
        continue;
      }

      if (!isMarketActiveForWeather(market)) {
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

    // Apply selection mode
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
  }

  private applySelectionMode(signals: WeatherSignal[]): WeatherSignal[] {
    if (signals.length === 0) return [];
    if (!this.risk) return signals;

    const mode = this.risk.weatherAlgoSelectionMode ?? 'single';

    if (mode === 'single') {
      // Pick the signal with the highest absolute edge
      const best = signals.reduce((a, b) => (Math.abs(b.edge) > Math.abs(a.edge) ? b : a));
      return [best];
    }

    if (mode === 'multi') {
      // Sort by absolute edge descending, take top N
      const maxN = this.risk.weatherAlgoMaxSignalsPerEvent ?? 3;
      const sorted = [...signals].sort((a, b) => Math.abs(b.edge) - Math.abs(a.edge));
      // Never two signals in the same direction on the same event
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
      // Spread: pick the YES with highest edge + the NO with highest edge
      // on the same event, capped at one per direction to avoid conflicting positions.
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

function isMarketActiveForWeather(market: MarketListItemDto): boolean {
  if (market.closed) return false;
  if (market.acceptingOrders === false) return false;
  if (market.endDate) {
    const end = new Date(market.endDate).getTime();
    // Require at least 1 hour before resolution to avoid last-minute execution risk
    if (end - Date.now() < 3_600_000) return false;
  }
  return true;
}
