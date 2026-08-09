import {
  type WeatherConfig,
  computeTakerFee,
  isMarketActiveForWeather,
  resolveWeatherEntryExitParams,
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
import { ClockedWeatherForecastStrategy } from './clocked-weather-forecast.strategy.js';
import {
  buildMarketListItem,
  ForecastRevisionStore,
} from './context-builder.js';
import { resolveWeatherBucket } from './resolution.js';

function resolvedExitMeta(risk: WeatherConfig): Record<string, number | null> {
  const p = resolveWeatherEntryExitParams(risk, 'sim', null);
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
  private strategy: ClockedWeatherForecastStrategy;
  private exitManager: WeatherExitManager;
  private forecastStore = new ForecastRevisionStore();
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
    this.strategy = new ClockedWeatherForecastStrategy();
    this.strategy.setRiskConfig(ctx.configSnapshot);
    this.exitManager = new WeatherExitManager(ctx.configSnapshot);
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
  }

  private hasOpenCity(ctx: RunContext, city: string | null | undefined): boolean {
    if (!city) return false;
    const normalized = city.toLowerCase();
    return ctx.ledger
      .openPositions()
      .some((p) => (p.city ?? '').toLowerCase() === normalized);
  }

  private isDailyLossBreached(ctx: RunContext): boolean {
    const maxDailyLoss = ctx.configSnapshot.weatherAlgoMaxDailyLossUsdc;
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

    const maxExposure = risk.weatherAlgoMaxExposureUsdc;
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

    const action = ctx.configSnapshot.weatherAlgoKillSwitchAction ?? 'block_entries';
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

    const minHours = risk.weatherAlgoCloseBeforeResolutionHours ?? 1;
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
      maxPositionSizeUsdc: risk.weatherAlgoMaxPositionSizeUsdc,
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
        ...resolvedExitMeta(risk),
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
      maxPositionSizeUsdc: ctx.configSnapshot.weatherAlgoMaxPositionSizeUsdc,
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
        ...resolvedExitMeta(ctx.configSnapshot),
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
