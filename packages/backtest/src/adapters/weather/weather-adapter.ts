import type { WeatherConfig } from '@polywatch/core';
import { computeTakerFee } from '@polywatch/core';
import type { BacktestEvent } from '../../engine/events.js';
import type { RunContext } from '../../engine/runner.js';
import type { BacktestDomainAdapter } from '../backtest-domain-adapter.js';
import {
  simulateWeatherEntryFill,
  BACKTEST_PLATFORM_FEE,
} from '../../engine/fill-engine.js';
import { WeatherExitManager } from '../../engine/exit-manager.js';
import { ClockedWeatherForecastStrategy } from './clocked-weather-forecast.strategy.js';
import {
  buildMarketListItem,
  ForecastRevisionStore,
} from './context-builder.js';
import { resolveWeatherBucket } from './resolution.js';

/**
 * Weather backtest adapter.
 *
 * - reevaluate mode: on each book_tick, reconstruct the market + forecast
 *   context and call the (clocked) WeatherForecastStrategy to decide entry.
 * - replay mode: on each signal event with decision==='signal', enter at the
 *   recorded yes price (no strategy re-evaluation).
 *
 * Exits (drift / bucket / pre-close / SL-TP-trailing / resolution) are
 * evaluated purely in-memory on each book tick touching an open position.
 */
export class WeatherBacktestAdapter implements BacktestDomainAdapter {
  private strategy: ClockedWeatherForecastStrategy;
  private exitManager: WeatherExitManager;
  private forecastStore = new ForecastRevisionStore();
  private warningFired = new Set<string>();
  private staticWarningsEmitted = false;
  /** Latest book tick per conditionId, so exits can be evaluated for all open positions. */
  private lastTickByCondition = new Map<string, import('../../engine/events.js').BookTickEventData>();

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
      'minTimeToClose non appliqué en backtest',
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

    const maxDailyLoss = risk.weatherAlgoMaxDailyLossUsdc;
    if (maxDailyLoss != null) {
      const dailyPnl = ctx.ledger.dailyRealizedPnl(ctx.clock.now());
      if (dailyPnl <= -maxDailyLoss) {
        return false;
      }
    }

    return true;
  }

  async handle(event: BacktestEvent, ctx: RunContext): Promise<void> {
    switch (event.kind) {
      case 'forecast':
        this.forecastStore.set(event.data);
        return;
      case 'book_tick':
        await this.onBookTick(event.data, ctx);
        return;
      case 'signal':
        await this.onSignal(event.data, ctx);
        return;
      default:
        return;
    }
  }

  private getCurrentForecast(ctx: RunContext, city: string, dateIso: string, metric: string) {
    const revision = this.forecastStore.get(city, dateIso, metric, ctx.clock.now());
    if (revision) {
      return { forecastMean: revision.forecastMean, forecastStdDev: revision.forecastStdDev };
    }
    return null;
  }

  private async onBookTick(
    data: import('../../engine/events.js').BookTickEventData,
    ctx: RunContext,
  ): Promise<void> {
    const risk = ctx.configSnapshot;

    this.lastTickByCondition.set(data.conditionId, data);

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
      city: data.snapshotCity,
      yesPrice: data.yesPrice,
      entryUsdc: ctx.params.entryUsdc,
      entryAt: ctx.clock.now(),
      slippageBps: ctx.params.slippageBps,
      maxPositionSizeUsdc: risk.weatherAlgoMaxPositionSizeUsdc,
      entryReason: result.signal.entryBucketComparison ?? null,
      meta: {
        strategyId: result.signal.strategyId,
        edge: result.signal.edge,
        dynamicMinEdge: result.signal.dynamicMinEdge,
        entryMean: ctxWeather.forecastMean,
        entryBucketComparison: result.signal.entryBucketComparison ?? null,
        entryBucketBounds: result.signal.entryBucketBounds ?? null,
        detailReasons: result.signal.reasons.join(' | '),
      },
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
      },
    });
  }

  private async onSignal(
    data: import('../../engine/events.js').SignalEventData,
    ctx: RunContext,
  ): Promise<void> {
    if (data.decision !== 'signal') return;
    if (data.yesPrice == null) return;

    if (ctx.ledger.isDuplicateOpen(data.conditionId)) return;
    if (ctx.ledger.openCount() >= ctx.params.maxConcurrentPositions) return;
    if (data.city && this.exitManager.isReentryBlocked(data.city, ctx.clock.now())) return;
    if (this.hasOpenCity(ctx, data.city)) return;

    if (!this.canEnter(ctx, ctx.params.entryUsdc, data.yesPrice)) return;

    const fill = simulateWeatherEntryFill({
      conditionId: data.conditionId,
      city: data.city,
      yesPrice: data.yesPrice,
      entryUsdc: ctx.params.entryUsdc,
      entryAt: ctx.clock.now(),
      slippageBps: ctx.params.slippageBps,
      maxPositionSizeUsdc: ctx.configSnapshot.weatherAlgoMaxPositionSizeUsdc,
      entryReason: data.bucketComparison ?? null,
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
      },
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
      },
    });
  }

  private resolveResolutionTimeMs(
    tick: import('../../engine/events.js').BookTickEventData,
  ): number | null {
    if (tick.endDate) {
      return tick.endDate.getTime();
    }
    if (tick.snapshotTargetDateIso) {
      const parsed = new Date(`${tick.snapshotTargetDateIso}T23:59:59Z`).getTime();
      return Number.isNaN(parsed) ? null : parsed + 86_400_000;
    }
    return null;
  }

  private async evaluateExits(ctx: RunContext): Promise<void> {
    for (const pos of ctx.ledger.openPositions()) {
      const tick = this.lastTickByCondition.get(pos.conditionId);
      if (!tick || tick.yesPrice == null) continue;

      ctx.ledger.updateMark(pos.conditionId, tick.yesPrice);

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
        yesPrice: tick.yesPrice,
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
        yesPrice: tick.yesPrice,
        now: ctx.clock.now(),
        slippageBps: ctx.params.slippageBps,
      });
      if (slTp) {
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
