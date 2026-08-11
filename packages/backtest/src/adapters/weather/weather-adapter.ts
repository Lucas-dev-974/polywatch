import {
  type WeatherConfig,
  computeTakerFee,
  isMarketActiveForWeather,
  resolveWeatherEntryExitParams,
  getStrategyParams,
  type WeatherStrategyParamsBag,
  WEATHER_FORECAST_STRATEGY_ID,
  type WeatherStrategyId,
} from '@polywatch/core';
import type { BacktestEvent, BookTickEventData, SignalEventData } from '../../engine/events.js';
import type { RunContext } from '../../engine/runner.js';
import type { BacktestDomainAdapter } from '../backtest-domain-adapter.js';
import {
  simulateWeatherEntryFill,
  simulateWeatherExitFill,
  BACKTEST_PLATFORM_FEE,
} from '../../engine/fill-engine.js';
import { WeatherExitManager } from '../../engine/exit-manager.js';
import { ClockedWeatherStrategy, createWeatherStrategy } from './clocked-weather-strategy.js';
import type { WeatherSignal } from '@polywatch/weather-algo';
import {
  buildMarketListItem,
  ForecastRevisionStore,
} from './context-builder.js';
import { resolveWeatherBucket } from './resolution.js';
import {
  BucketGroupStore,
  buildActiveMarketsForGroup,
  createRunnerSimStrategies,
  evaluateRunnerSimGroup,
  selectRunnerSimSignals,
} from './runner-sim.js';

function resolvedExitMeta(risk: WeatherConfig, strategyId?: string | null): Record<string, number | null> {
  const p = resolveWeatherEntryExitParams(risk, 'sim', null, strategyId);
  return {
    slBidPoints: p.slBidPoints,
    tpBidPoints: p.tpBidPoints,
    trailingBidPoints: p.trailingBidPoints,
    trailingActivationBidPoints: p.trailingActivationBidPoints,
  };
}

/**
 * Weather backtest adapter.
 *
 * - reevaluate mode: on each book_tick, reconstruct the market + forecast
 *   context and call the (clocked) WeatherForecastStrategy to decide entry.
 * - replay mode: on each signal event with decision==='signal', enter at the
 *   recorded yes price (no strategy re-evaluation).
 *
 * Exits (drift / bucket / pre-close / SL-TP-trailing / resolution / kill-switch)
 * are evaluated purely in-memory on each book tick.
 */
export class WeatherBacktestAdapter implements BacktestDomainAdapter {
  private strategy: ClockedWeatherStrategy;
  private runnerSimStrategies: ClockedWeatherStrategy[] = [];
  private readonly bucketGroupStore = new BucketGroupStore();
  private pendingRunnerSimSignals: WeatherSignal[] = [];
  private lastRunnerSimBatchAt: number | null = null;
  private exitManager: WeatherExitManager;
  private forecastStore = new ForecastRevisionStore();
  private readonly strategyId: WeatherStrategyId;
  private readonly bag: WeatherStrategyParamsBag;
  private warningFired = new Set<string>();
  private staticWarningsEmitted = false;
  private lifecycleSkipped = 0;
  private killSwitchFired = false;
  /** Latest book tick + event time per conditionId. */
  private lastTickByCondition = new Map<
    string,
    { tick: BookTickEventData; at: Date }
  >();

  constructor(ctx: RunContext) {
    const strategyId = (ctx.params.strategyId ?? WEATHER_FORECAST_STRATEGY_ID) as WeatherStrategyId;
    this.strategyId = strategyId;
    this.bag = getStrategyParams(ctx.configSnapshot, strategyId);
    if (ctx.params.backtestExecutionMode === 'runner-sim') {
      this.runnerSimStrategies = createRunnerSimStrategies(ctx.configSnapshot, strategyId);
      this.strategy = this.runnerSimStrategies[0] ?? createWeatherStrategy(strategyId);
    } else {
      this.strategy = createWeatherStrategy(strategyId);
    }
    for (const s of this.runnerSimStrategies.length > 0 ? this.runnerSimStrategies : [this.strategy]) {
      s.setRiskConfig(getStrategyParams(ctx.configSnapshot, s.id));
    }
    this.exitManager = new WeatherExitManager(ctx.configSnapshot, strategyId);
  }

  async finish(ctx: RunContext): Promise<void> {
    if (ctx.params.backtestExecutionMode === 'runner-sim') {
      await this.flushPendingRunnerSimSignals(ctx);
    }
  }

  private warnOnce(ctx: RunContext, code: string, message: string): void {
    if (!this.warningFired.has(code)) {
      this.warningFired.add(code);
      ctx.fidelityWarnings.push(`${code}: ${message}`);
    }
  }

  private setOrUpdateWarning(ctx: RunContext, code: string, message: string): void {
    const full = `${code}: ${message}`;
    const idx = ctx.fidelityWarnings.findIndex((w) => w.startsWith(`${code}:`));
    if (idx >= 0) {
      ctx.fidelityWarnings[idx] = full;
    } else {
      ctx.fidelityWarnings.push(full);
    }
    this.warningFired.add(code);
  }

  private noteLifecycleSkip(ctx: RunContext): void {
    this.lifecycleSkipped += 1;
    this.setOrUpdateWarning(
      ctx,
      'market_lifecycle_filtered',
      `${this.lifecycleSkipped} tick(s) exclus (closed/acceptingOrders/token/minHours)`,
    );
  }

  private emitStaticFidelityWarnings(ctx: RunContext): void {
    if (this.staticWarningsEmitted) return;
    this.staticWarningsEmitted = true;
    this.warnOnce(
      ctx,
      'risk_sl_confirmation_ignored',
      'SL sans confirmation ticks (déclenchement au 1er tick)',
    );
    this.warnOnce(
      ctx,
      'risk_sizing_simplified_fixed_usdc',
      'Sizing fixe entryUsdc (pas de signal-score sizing live)',
    );
    this.warnOnce(
      ctx,
      'risk_min_time_to_close_ignored',
      'minTimeToClose non appliqué en backtest (closeBeforeHours appliqué à l\'entrée)',
    );
    this.warnOnce(
      ctx,
      'fill_no_book_depth',
      'Pas de profondeur de carnet — fills non plafonnés par la liquidité',
    );
    if (ctx.params.detectionDelayMs > 0) {
      this.warnOnce(
        ctx,
        'detection_delay_unused',
        'detectionDelayMs paramétré mais non appliqué au replay',
      );
    }
    if (ctx.params.mode === 'replay' && ctx.params.fidelityMinutes != null) {
      this.warnOnce(
        ctx,
        'replay_fidelity_filter_unsupported',
        'filtre intervalle ignoré en mode replay (weather_evaluation_log ne porte pas fidelity_minutes)',
      );
    }
  }

  private hasOpenCity(ctx: RunContext, city: string | null | undefined): boolean {
    if (!city) return false;
    const normalized = city.toLowerCase();
    return ctx.ledger
      .openPositions()
      .some((p) => (p.city ?? '').toLowerCase() === normalized);
  }

  private isDailyLossBreached(ctx: RunContext): boolean {
    const bag = this.bag;
    const maxDailyLoss = bag.maxDailyLossUsdc;
    if (maxDailyLoss == null) return false;
    return ctx.ledger.dailyRealizedPnl(ctx.clock.now()) <= -maxDailyLoss;
  }

  private canEnter(
    ctx: RunContext,
    entryUsdc: number,
    yesPrice: number,
  ): boolean {
    this.emitStaticFidelityWarnings(ctx);
    const risk = ctx.configSnapshot;
    const slippage = ctx.params.slippageBps;
    const entryPrice = yesPrice * (1 + slippage / 10_000);
    const qty = entryUsdc / entryPrice;
    const estFees = computeTakerFee(qty, entryPrice, BACKTEST_PLATFORM_FEE);
    const cost = entryUsdc + estFees;

    if (ctx.ledger.cash < cost) {
      return false;
    }

    const maxExposure = this.bag.maxExposureUsdc;
    if (maxExposure != null && ctx.ledger.openExposure() + entryUsdc > maxExposure) {
      return false;
    }

    if (this.isDailyLossBreached(ctx)) {
      return false;
    }

    return true;
  }

  /** Close all open positions when kill-switch action is force_close_all. */
  private maybeForceCloseAll(ctx: RunContext): void {
    if (this.killSwitchFired) return;
    if (!this.isDailyLossBreached(ctx)) return;

    const action = this.bag.killSwitchAction;
    if (action !== 'force_close_all') {
      this.warnOnce(
        ctx,
        'kill_switch_block_entries',
        `Kill-switch actif (${action}) — nouvelles entrées bloquées`,
      );
      return;
    }

    // Mark fired before the loop so a mid-loop throw cannot re-enter and
    // double-close. If any close fails, we clear the flag so the next tick retries.
    this.killSwitchFired = true;
    this.warnOnce(
      ctx,
      'kill_switch_force_close',
      'Kill-switch force_close_all — clôture de toutes les positions ouvertes',
    );

    let failed = 0;
    for (const pos of [...ctx.ledger.openPositions()]) {
      try {
        const cached = this.lastTickByCondition.get(pos.conditionId);
        const yesPrice = cached?.tick.yesPrice != null ? cached.tick.yesPrice : pos.markPrice;
        const { exitPrice, fees } = simulateWeatherExitFill({
          qty: pos.qty,
          yesPrice,
          slippageBps: ctx.params.slippageBps,
        });
        ctx.ledger.closePosition({
          conditionId: pos.conditionId,
          exitPrice,
          exitAt: ctx.clock.now(),
          exitReason: 'KILL_SWITCH',
          fees,
        });
      } catch {
        failed += 1;
      }
    }

    if (failed > 0 || ctx.ledger.openCount() > 0) {
      this.killSwitchFired = false;
      this.setOrUpdateWarning(
        ctx,
        'kill_switch_partial_close',
        `${failed} close(s) échoué(s) / ${ctx.ledger.openCount()} encore ouverte(s) — retry au prochain tick`,
      );
    }
  }

  async handle(event: BacktestEvent, ctx: RunContext): Promise<void> {
    switch (event.kind) {
      case 'forecast':
        this.forecastStore.set(event.data);
        return;
      case 'book_tick':
        await this.onBookTick(event.data, event.at, ctx);
        return;
      case 'signal':
        await this.onSignal(event.data, ctx);
        return;
      default:
        return;
    }
  }

  private getCurrentForecast(ctx: RunContext, city: string, dateIso: string, metric: string) {
    const revision = this.forecastStore.get(city, dateIso, metric);
    if (revision) {
      return { forecastMean: revision.forecastMean, forecastStdDev: revision.forecastStdDev };
    }
    return null;
  }

  private async flushPendingRunnerSimSignals(ctx: RunContext): Promise<void> {
    if (this.pendingRunnerSimSignals.length === 0) return;

    const risk = ctx.configSnapshot;
    const selected = selectRunnerSimSignals(this.pendingRunnerSimSignals, risk);
    this.pendingRunnerSimSignals = [];

    const seenCities = new Set<string>();
    for (const pos of ctx.ledger.openPositions()) {
      if (pos.city) seenCities.add(pos.city.toLowerCase());
    }

    for (const signal of selected) {
      const cityKey = (signal.city ?? '').toLowerCase();
      if (cityKey && seenCities.has(cityKey)) continue;
      if (ctx.ledger.isDuplicateOpen(signal.conditionId)) continue;
      if (ctx.ledger.openCount() >= ctx.params.maxConcurrentPositions) break;
      if (signal.city && this.exitManager.isReentryBlocked(signal.city, ctx.clock.now())) continue;

      const cached = this.lastTickByCondition.get(signal.conditionId);
      const yesPrice = cached?.tick.yesPrice;
      if (yesPrice == null) continue;
      if (!this.canEnter(ctx, ctx.params.entryUsdc, yesPrice)) continue;

      const fill = simulateWeatherEntryFill({
        conditionId: signal.conditionId,
        yesPrice,
        entryUsdc: ctx.params.entryUsdc,
        slippageBps: ctx.params.slippageBps,
        maxPositionSizeUsdc: this.bag.maxPositionSizeUsdc,
      });

      ctx.ledger.openPosition({
        conditionId: signal.conditionId,
        city: signal.city,
        qty: fill.qty,
        entryPrice: fill.entryPrice,
        entryAt: ctx.clock.now(),
        fees: fill.fees,
        entryReason: 'signal',
        meta: {
          strategyId: signal.strategyId,
          edge: signal.edge,
          dynamicMinEdge: signal.dynamicMinEdge,
          entryMean: signal.forecastMean,
          entryBucketComparison: signal.entryBucketComparison ?? null,
          entryBucketBounds: signal.entryBucketBounds ?? null,
          detailReasons: signal.reasons.join(' | '),
          ...resolvedExitMeta(risk, this.strategyId),
        },
      });

      if (cityKey) seenCities.add(cityKey);
    }
  }

  private async onBookTickRunnerSim(
    data: BookTickEventData,
    at: Date,
    ctx: RunContext,
  ): Promise<void> {
    const batchAt = at.getTime();
    if (this.lastRunnerSimBatchAt != null && batchAt !== this.lastRunnerSimBatchAt) {
      await this.flushPendingRunnerSimSignals(ctx);
    }
    this.lastRunnerSimBatchAt = batchAt;

    const groupKey = this.bucketGroupStore.upsert(data);
    const minHours = this.bag.closeBeforeResolutionHours;

    const forecast = this.getCurrentForecast(
      ctx,
      data.snapshotCity,
      data.snapshotTargetDateIso,
      data.snapshotMetric,
    );
    const ctxWeather = {
      forecastMean: forecast?.forecastMean ?? data.snapshotForecastMean ?? 0,
      forecastStdDev: forecast?.forecastStdDev ?? 0,
    };

    const ticks = this.bucketGroupStore.ticksForGroup(groupKey);
    const activeMarkets = buildActiveMarketsForGroup(ticks, minHours, ctx.clock.now().getTime());
    if (activeMarkets.length === 0) return;

    const signal = await evaluateRunnerSimGroup(
      this.runnerSimStrategies,
      activeMarkets,
      ctxWeather,
      ctx.clock.now(),
    );
    if (signal) {
      this.pendingRunnerSimSignals.push(signal);
    }
  }

  private async onBookTick(
    data: BookTickEventData,
    at: Date,
    ctx: RunContext,
  ): Promise<void> {
    const risk = ctx.configSnapshot;

    this.lastTickByCondition.set(data.conditionId, { tick: data, at });

    this.maybeForceCloseAll(ctx);
    await this.evaluateExits(ctx);

    if (ctx.ledger.isDuplicateOpen(data.conditionId)) return;

    const maxPos = ctx.params.maxConcurrentPositions;
    if (ctx.ledger.openCount() >= maxPos) return;

    if (this.exitManager.isReentryBlocked(data.snapshotCity, ctx.clock.now())) return;

    if (ctx.params.mode === 'replay') {
      return;
    }

    if (ctx.params.backtestExecutionMode === 'runner-sim') {
      await this.onBookTickRunnerSim(data, at, ctx);
      return;
    }

    const forecast = this.getCurrentForecast(
      ctx,
      data.snapshotCity,
      data.snapshotTargetDateIso,
      data.snapshotMetric,
    );

    const market = buildMarketListItem({
      tick: data,
      city: data.snapshotCity,
      targetDateIso: data.snapshotTargetDateIso,
      metric: data.snapshotMetric,
      eventSlug: data.eventSlug,
      tokenIdYes: data.tokenIdYes,
    });
    if (!market) {
      this.warnOnce(
        ctx,
        'unsupported_metric_or_bucket',
        `Marché ignoré (metric=${data.snapshotMetric} non supporté) pour ${data.snapshotCity}`,
      );
      return;
    }

    const minHours = this.bag.closeBeforeResolutionHours;
    if (!isMarketActiveForWeather(market, minHours, ctx.clock.now().getTime())) {
      this.noteLifecycleSkip(ctx);
      return;
    }

    if (data.yesPrice == null) return;

    const ctxWeather = {
      forecastMean: forecast?.forecastMean ?? data.snapshotForecastMean ?? 0,
      forecastStdDev: forecast?.forecastStdDev ?? 0,
    };

    const result = await this.strategy.evaluateAt(market, ctxWeather, ctx.clock.now());
    if (result.kind !== 'signal') return;

    if (this.hasOpenCity(ctx, data.snapshotCity)) return;

    if (!this.canEnter(ctx, ctx.params.entryUsdc, data.yesPrice)) return;

    const fill = simulateWeatherEntryFill({
      conditionId: data.conditionId,
      yesPrice: data.yesPrice,
      entryUsdc: ctx.params.entryUsdc,
      slippageBps: ctx.params.slippageBps,
      maxPositionSizeUsdc: this.bag.maxPositionSizeUsdc,
    });

    ctx.ledger.openPosition({
      conditionId: data.conditionId,
      city: data.snapshotCity,
      qty: fill.qty,
      entryPrice: fill.entryPrice,
      entryAt: ctx.clock.now(),
      fees: fill.fees,
      entryReason: 'signal',
      meta: {
        strategyId: result.signal.strategyId,
        edge: result.signal.edge,
        dynamicMinEdge: result.signal.dynamicMinEdge,
        entryMean: ctxWeather.forecastMean,
        entryBucketComparison: result.signal.entryBucketComparison ?? null,
        entryBucketBounds: result.signal.entryBucketBounds ?? null,
        detailReasons: result.signal.reasons.join(' | '),
        ...resolvedExitMeta(risk, this.strategyId),
      },
    });
  }

  private async onSignal(data: SignalEventData, ctx: RunContext): Promise<void> {
    if (data.decision !== 'signal') return;
    if (data.yesPrice == null) return;

    this.maybeForceCloseAll(ctx);

    if (ctx.ledger.isDuplicateOpen(data.conditionId)) return;
    if (ctx.ledger.openCount() >= ctx.params.maxConcurrentPositions) return;
    if (data.city && this.exitManager.isReentryBlocked(data.city, ctx.clock.now())) return;
    if (this.hasOpenCity(ctx, data.city)) return;

    if (!this.canEnter(ctx, ctx.params.entryUsdc, data.yesPrice)) return;

    const fill = simulateWeatherEntryFill({
      conditionId: data.conditionId,
      yesPrice: data.yesPrice,
      entryUsdc: ctx.params.entryUsdc,
      slippageBps: ctx.params.slippageBps,
      maxPositionSizeUsdc: this.bag.maxPositionSizeUsdc,
    });

    ctx.ledger.openPosition({
      conditionId: data.conditionId,
      city: data.city,
      qty: fill.qty,
      entryPrice: fill.entryPrice,
      entryAt: ctx.clock.now(),
      fees: fill.fees,
      entryReason: 'replay_signal',
      meta: {
        strategyId: data.strategyId,
        edge: data.edge ?? 0,
        dynamicMinEdge: data.dynamicMinEdge ?? 0,
        forecastProb: data.forecastProb ?? 0,
        entryBucketComparison: data.bucketComparison ?? null,
        entryBucketBounds: {
          low: data.bucketLow,
          high: data.bucketHigh,
          target: data.bucketTarget,
        },
        ...resolvedExitMeta(ctx.configSnapshot, this.strategyId),
      },
    });
  }

  private resolveResolutionTimeMs(tick: BookTickEventData): number | null {
    if (tick.endDate) {
      return tick.endDate.getTime();
    }
    if (tick.snapshotTargetDateIso) {
      const parsed = new Date(`${tick.snapshotTargetDateIso}T23:59:59Z`).getTime();
      return Number.isNaN(parsed) ? null : parsed + 86_400_000;
    }
    return null;
  }

  private noteStaleTickIfNeeded(ctx: RunContext, tickAt: Date): void {
    const pollMs = ctx.configSnapshot.weatherAlgoPollMs ?? 1_800_000;
    const age = ctx.clock.now().getTime() - tickAt.getTime();
    if (age > pollMs) {
      this.warnOnce(
        ctx,
        'exit_stale_tick',
        `Sortie évaluée avec un tick plus vieux que pollMs (${Math.round(age / 1000)}s)`,
      );
    }
  }

  private async evaluateExits(ctx: RunContext): Promise<void> {
    for (const pos of ctx.ledger.openPositions()) {
      const cached = this.lastTickByCondition.get(pos.conditionId);
      if (!cached || cached.tick.yesPrice == null) continue;
      const { tick, at: tickAt } = cached;
      const yesPrice = cached.tick.yesPrice;

      ctx.ledger.updateMark(pos.conditionId, yesPrice);

      const resolutionTimeMs = this.resolveResolutionTimeMs(tick);
      if (
        resolutionTimeMs != null &&
        !Number.isNaN(resolutionTimeMs) &&
        resolutionTimeMs <= ctx.clock.now().getTime()
      ) {
        if (!tick.endDate) {
          this.warnOnce(
            ctx,
            'resolution_no_endate_fallback',
            'Résolution sans endDate: fallback targetDate+24h',
          );
        }
        const res = resolveWeatherBucket({
          forecastMean:
            this.getCurrentForecast(
              ctx,
              tick.snapshotCity,
              tick.snapshotTargetDateIso,
              tick.snapshotMetric,
            )?.forecastMean ?? tick.snapshotForecastMean,
          bucketComparison: tick.bucketComparison,
          bucketTarget: tick.bucketTarget,
          bucketLow: tick.bucketLow,
          bucketHigh: tick.bucketHigh,
        });
        if (res.winningOutcome == null) {
          this.warnOnce(
            ctx,
            'resolution_no_forecast',
            'Résolution impossible sans forecast — position laissée ouverte',
          );
          continue;
        }
        const exitPrice = res.winningOutcome === 'YES' ? 1 : 0;
        ctx.ledger.closePosition({
          conditionId: pos.conditionId,
          exitPrice,
          exitAt: ctx.clock.now(),
          exitReason: 'RESOLUTION',
          fees: 0,
        });
        this.warnOnce(
          ctx,
          'resolution_proxy_forecast',
          'Résolution approximée par forecast final',
        );
        continue;
      }

      if (resolutionTimeMs != null && Number.isNaN(resolutionTimeMs)) {
        this.warnOnce(
          ctx,
          'resolution_invalid_date',
          'Date de résolution invalide — skip',
        );
      }

      const currentMean =
        this.getCurrentForecast(
          ctx,
          tick.snapshotCity,
          tick.snapshotTargetDateIso,
          tick.snapshotMetric,
        )?.forecastMean ?? tick.snapshotForecastMean;

      const decision = this.exitManager.evaluate(pos, {
        yesPrice,
        endDate: tick.endDate,
        currentMean,
        now: ctx.clock.now(),
        slippageBps: ctx.params.slippageBps,
        entryMean: (pos.meta.entryMean as number | undefined) ?? null,
        entryBucketComparison: (pos.meta.entryBucketComparison as string | null | undefined) ?? null,
        entryBucketBounds:
          (pos.meta.entryBucketBounds as {
            low?: number | null;
            high?: number | null;
            target?: number | null;
          } | null | undefined) ?? null,
      });
      if (decision) {
        this.noteStaleTickIfNeeded(ctx, tickAt);
        ctx.ledger.closePosition({
          conditionId: pos.conditionId,
          exitPrice: decision.exitPrice,
          exitAt: ctx.clock.now(),
          exitReason: decision.reason,
          fees: decision.fees,
        });
        continue;
      }

      const slTp = this.exitManager.evaluateSlTpTrailing(pos, {
        yesPrice,
        now: ctx.clock.now(),
        slippageBps: ctx.params.slippageBps,
      });
      if (slTp) {
        this.noteStaleTickIfNeeded(ctx, tickAt);
        ctx.ledger.closePosition({
          conditionId: pos.conditionId,
          exitPrice: slTp.exitPrice,
          exitAt: ctx.clock.now(),
          exitReason: slTp.reason,
          fees: slTp.fees,
        });
      }
    }
  }
}
