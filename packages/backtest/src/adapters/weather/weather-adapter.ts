import {
  type WeatherConfig,
  computeTakerFee,
  isMarketActiveForWeather,
  resolveWeatherEntryExitParams,
  getStrategyParams,
  type WeatherStrategyParamsBag,
  WEATHER_FORECAST_STRATEGY_ID,
  WEATHER_HIGHEST_YES_STRATEGY_ID,
  type WeatherStrategyId,
} from '@polywatch/core';
import type { BacktestEvent, BookTickEventData, SignalEventData } from '../../engine/events.js';
import type { RunContext } from '../../engine/runner.js';
import type { LedgerPosition } from '../../engine/ledger.js';
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
import {
  BucketGroupStore,
  buildActiveMarketsForGroup,
  createRunnerSimStrategies,
  evaluateRunnerSimGroup,
  selectRunnerSimSignals,
} from './runner-sim.js';
import { AdapterWarnings } from './adapter-warnings.js';

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
  private readonly warnings = new AdapterWarnings();
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
    this.exitManager = new WeatherExitManager();
  }

  async finish(ctx: RunContext): Promise<void> {
    if (ctx.params.backtestExecutionMode === 'runner-sim') {
      await this.flushPendingRunnerSimSignals(ctx);
    }

    // Ghost positions : positions encore ouvertes à la fin du run (aucun tick
    // de résolution reçu). On les force à la résolution pour ne pas fausser
    // l'équité finale / les stats. On utilise le dernier markPrice connu, sinon
    // entryPrice (coût neutre), et on marque la raison BACKTEST_INCOMPLETE_DATA.
    const open = ctx.ledger.openPositions();
    if (open.length > 0) {
      this.warnOnce(
        ctx,
        'ghost_positions_forced_resolution',
        `${open.length} position(s) encore ouverte(s) en fin de run — résolution forcée (données incomplètes)`,
      );
      for (const pos of open) {
        const exitPrice = pos.markPrice > 0 ? pos.markPrice : pos.entryPrice;
        ctx.ledger.closePosition({
          conditionId: pos.conditionId,
          exitPrice,
          exitAt: ctx.clock.now(),
          exitReason: 'BACKTEST_INCOMPLETE_DATA',
          fees: 0,
        });
      }
    }
  }

  private warnOnce(ctx: RunContext, code: string, message: string): void {
    this.warnings.warnOnce(ctx, code, message);
  }

  private setOrUpdateWarning(ctx: RunContext, code: string, message: string): void {
    this.warnings.setOrUpdateWarning(ctx, code, message);
  }

  private noteLifecycleSkip(ctx: RunContext): void {
    this.warnings.noteLifecycleSkip(ctx);
  }

  private emitStaticFidelityWarnings(ctx: RunContext): void {
    this.warnings.emitStaticFidelityWarnings(ctx);
  }

  private openCountForCityDate(
    ctx: RunContext,
    city: string | null | undefined,
    targetDateIso: string | null | undefined,
    strategyId?: string | null,
  ): number {
    if (!city || !targetDateIso) return 0;
    const normalized = city.toLowerCase();
    return ctx.ledger
      .openPositions()
      .filter(
        (p) =>
          (p.city ?? '').toLowerCase() === normalized &&
          p.targetDateIso === targetDateIso &&
          (p.meta?.strategyId ?? null) === strategyId,
      ).length;
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

    const seenCityDates = new Map<string, number>();
    for (const pos of ctx.ledger.openPositions()) {
      if (pos.city && pos.targetDateIso) {
        const key = `${pos.city.toLowerCase()}|${pos.targetDateIso}|${pos.meta?.strategyId ?? ''}`;
        seenCityDates.set(key, (seenCityDates.get(key) ?? 0) + 1);
      }
    }

    for (const signal of selected) {
      const cityKey = (signal.city ?? '').toLowerCase();
      const cityDateKey =
        cityKey && signal.targetDate
          ? `${cityKey}|${signal.targetDate.toISOString().slice(0, 10)}|${signal.strategyId}`
          : null;
      // §6 : résoudre maxPositionsPerCityDate par stratégie émettrice (alignement live).
      const signalBag = getStrategyParams(risk, signal.strategyId);
      const maxPerCityDate = Math.max(1, signalBag.maxPositionsPerCityDate ?? 1);
      if (cityDateKey && (seenCityDates.get(cityDateKey) ?? 0) >= maxPerCityDate) continue;
      if (ctx.ledger.isDuplicateOpen(signal.conditionId)) continue;
      if (ctx.ledger.openCount() >= ctx.params.maxConcurrentPositions) break;
      if (signal.city && this.exitManager.isReentryBlocked(signal.city, signal.targetDate.toISOString().slice(0, 10), ctx.clock.now(), risk, signal.strategyId)) continue;

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
        targetDateIso: signal.targetDate ? signal.targetDate.toISOString().slice(0, 10) : null,
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
          ...resolvedExitMeta(risk, signal.strategyId),
        },
      });

      if (cityDateKey) seenCityDates.set(cityDateKey, (seenCityDates.get(cityDateKey) ?? 0) + 1);
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

    if (data.snapshotTargetDateIso && this.exitManager.isReentryBlocked(data.snapshotCity, data.snapshotTargetDateIso, ctx.clock.now(), risk, this.strategyId)) return;

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

    if (
      this.openCountForCityDate(ctx, data.snapshotCity, data.snapshotTargetDateIso, this.strategyId) >=
      Math.max(1, this.bag.maxPositionsPerCityDate ?? 1)
    ) return;

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
      targetDateIso: data.snapshotTargetDateIso ?? null,
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

    const risk = ctx.configSnapshot;

    this.maybeForceCloseAll(ctx);

    if (ctx.ledger.isDuplicateOpen(data.conditionId)) return;
    if (ctx.ledger.openCount() >= ctx.params.maxConcurrentPositions) return;

    const cached = this.lastTickByCondition.get(data.conditionId);
    const targetDateIso = cached?.tick.snapshotTargetDateIso ?? data.snapshotTargetDateIso ?? null;

    if (data.city && targetDateIso && this.exitManager.isReentryBlocked(data.city, targetDateIso, ctx.clock.now(), risk, data.strategyId)) return;
    if (
      this.openCountForCityDate(ctx, data.city, targetDateIso, data.strategyId) >=
      Math.max(1, this.bag.maxPositionsPerCityDate ?? 1)
    ) return;

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
      targetDateIso,
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
        entryMean: data.snapshotForecastMean ?? null,
        entryBucketComparison: data.bucketComparison ?? null,
        entryBucketBounds: {
          low: data.bucketLow,
          high: data.bucketHigh,
          target: data.bucketTarget,
        },
        ...resolvedExitMeta(ctx.configSnapshot, data.strategyId),
      },
    });
  }

  /**
   * Résout une position par le prix YES du marché (règle validée) :
   * - `yesPrice >= 0.99` → YES (exitPrice = 1)
   * - `yesPrice <= 0.01` → NO (exitPrice = 0)
   * - 1 seul tick suffit (pas de durée de maintien).
   * Le forecast n'est plus utilisé pour la résolution (abandon total).
   * Retourne `true` si la position a été fermée, `false` sinon.
   */
  private tryResolveByPrice(
    ctx: RunContext,
    pos: LedgerPosition,
    tick: BookTickEventData,
  ): boolean {
    const yesPrice = tick.yesPrice ?? pos.markPrice ?? pos.entryPrice;
    if (yesPrice == null) {
      this.warnOnce(
        ctx,
        'resolution_no_price_whatsoever',
        'Résolution impossible — aucun prix disponible (tick, mark, entry)',
      );
      return false;
    }

    if (tick.yesPrice == null) {
      // markPrice est toujours non-null (initialisé à entryPrice). On ne peut
      // pas distinguer markPrice mis à jour par un tick antérieur de entryPrice
      // pur. On indique donc la source réelle via comparaison.
      const fallbackSource = pos.markPrice !== pos.entryPrice ? 'markPrice' : 'entryPrice';
      this.warnOnce(
        ctx,
        'resolution_price_fallback',
        `Résolution via fallback ${fallbackSource}=${yesPrice.toFixed(4)} (tick.yesPrice absent)`,
      );
    }

    let winningOutcome: 'YES' | 'NO' | null = null;
    if (yesPrice >= 0.99) {
      winningOutcome = 'YES';
    } else if (yesPrice <= 0.01) {
      winningOutcome = 'NO';
    }

    if (winningOutcome == null) {
      return false;
    }

    this.warnOnce(
      ctx,
      'resolution_by_price',
      'Résolution par prix YES (>=0.99 → YES / <=0.01 → NO) — pas de température observée',
    );

    const exitPrice = winningOutcome === 'YES' ? 1 : 0;
    ctx.ledger.closePosition({
      conditionId: pos.conditionId,
      exitPrice,
      exitAt: ctx.clock.now(),
      exitReason: 'RESOLUTION',
      fees: 0,
    });
    return true;
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
      if (!cached) continue;
      const { tick, at: tickAt } = cached;
      const yesPrice = tick.yesPrice;

      // Si tick.yesPrice est présent, on met à jour markPrice (source la plus
      // fraîche). Sinon, on confirme markPrice à la dernière valeur connue
      // (garde défensive) pour que tryResolveByPrice et l'equity restent cohérents.
      if (yesPrice != null) {
        ctx.ledger.updateMark(pos.conditionId, yesPrice);
      } else {
        const fallbackPrice = pos.markPrice > 0 ? pos.markPrice : pos.entryPrice;
        if (fallbackPrice > 0) {
          ctx.ledger.updateMark(pos.conditionId, fallbackPrice);
          this.warnOnce(
            ctx,
            'markprice_stale_carry_forward',
            `markPrice confirmé à la dernière valeur connue (${fallbackPrice.toFixed(4)}) car tick.yesPrice est null`,
          );
        }
      }

      const resolved = this.tryResolveByPrice(ctx, pos, tick);
      if (resolved) continue;

      // For non-resolution exits (drift, bucket, SL/TP), we need a current yesPrice
      if (yesPrice == null) continue;

      const currentMean = this.currentForecastMean(ctx, tick);
      const isHighestYes = pos.meta?.strategyId === WEATHER_HIGHEST_YES_STRATEGY_ID;
      if (!isHighestYes && this.tryExitByDecision(ctx, pos, tick, tickAt, yesPrice, currentMean)) continue;

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

  /** Forecast mean courant (ou fallback snapshot) pour un tick. */
  private currentForecastMean(ctx: RunContext, tick: BookTickEventData): number | null {
    return (
      this.getCurrentForecast(
        ctx,
        tick.snapshotCity,
        tick.snapshotTargetDateIso,
        tick.snapshotMetric,
      )?.forecastMean ?? tick.snapshotForecastMean
    );
  }

  /**
   * Évalue la sortie par décision (drift / bucket-exit) via `exitManager.evaluate`.
   * Retourne `true` si la position a été fermée. N'appelle `evaluate` qu'une
   * seule fois (side-effects markClosed/hysteresis préservés).
   */
  private tryExitByDecision(
    ctx: RunContext,
    pos: LedgerPosition,
    tick: BookTickEventData,
    tickAt: Date,
    yesPrice: number,
    currentMean: number | null,
  ): boolean {
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
      risk: ctx.configSnapshot,
    });
    if (!decision) return false;
    this.noteStaleTickIfNeeded(ctx, tickAt);
    ctx.ledger.closePosition({
      conditionId: pos.conditionId,
      exitPrice: decision.exitPrice,
      exitAt: ctx.clock.now(),
      exitReason: decision.reason,
      fees: decision.fees,
    });
    return true;
  }
}
