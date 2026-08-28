import {
  type WeatherConfig,
  shouldCloseForForecastDrift,
  shouldCloseForBucketExit,
  shouldEmitBucketExit,
  resolveCityFollowSwitchMode,
  getStrategyParamsForMode,
  DEFAULT_WEATHER_STRATEGY_PARAMS,
  type BacktestExitReason,
} from '@polywatch/core';
import { type LedgerPosition } from './ledger.js';
import { simulateWeatherExitFill } from './fill-engine.js';

export interface ExitDecision {
  reason: BacktestExitReason;
  exitPrice: number;
  fees: number;
}

/** Float tolerance for closure-PnL threshold comparisons (percent). */
const CLOSURE_PNL_EPSILON = 1e-9;

/** Clé de throttle ré-entrée : stratifiée par stratégie pour ne pas croiser les stratégies. */
function reentryKey(city: string, targetDateIso: string, strategyId: string | null): string {
  return `${city}|${targetDateIso}|${strategyId ?? 'default'}`;
}

function readResolvedPercent(
  meta: Record<string, unknown>,
  key: string,
): number | null {
  const v = meta[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * Weather exit rules evaluated purely in-memory at each book tick that
 * touches an open position. Mirrors live WeatherExitEvaluator behaviour:
 * - re-entry throttle for bucket/drift exits and resolution
 * - bucket hysteresis advances at most once per weatherAlgoPollMs
 * - SL/TP/trailing use percentage thresholds (of invested amount) resolved
 *   at entry (meta.*Percent)
 */
export class WeatherExitManager {
  /** positionId (conditionId) -> consecutive out-of-bucket polls. */
  private bucketHysteresis = new Map<string, number>();
  /** positionId -> last virtual time hysteresis was advanced. */
  private lastHysteresisAdvanceAt = new Map<string, number>();
  /** `city|dateIso|strategyId` -> re-entry blocked until (epoch ms). */
  private reentryBlockedUntil = new Map<string, number>();
  /** `city|dateIso|strategyId` -> cumulative entry count for the run. */
  private cityDateEntryCounts = new Map<string, number>();

  isReentryBlocked(
    city: string,
    targetDateIso: string | null,
    now: Date,
    strategyId: string | null,
  ): boolean {
    if (!targetDateIso) return false;
    const until = this.reentryBlockedUntil.get(reentryKey(city, targetDateIso, strategyId));
    return until != null && now.getTime() < until;
  }

  /** Throttle re-entry until `now + throttleMs` (extends an existing longer block). */
  markReentryBlocked(
    city: string,
    targetDateIso: string | null,
    now: Date,
    strategyId: string | null,
    throttleMs: number,
  ): void {
    if (!targetDateIso || throttleMs <= 0) return;
    const key = reentryKey(city, targetDateIso, strategyId);
    const until = now.getTime() + throttleMs;
    const prev = this.reentryBlockedUntil.get(key) ?? 0;
    if (until > prev) this.reentryBlockedUntil.set(key, until);
  }

  /** Throttle une ville/date pour une stratégie (résolution et sorties drift/bucket). */
  markClosed(
    city: string,
    targetDateIso: string | null,
    now: Date,
    strategyId: string | null,
    throttleMs: number,
  ): void {
    this.markReentryBlocked(city, targetDateIso, now, strategyId, throttleMs);
  }

  isEntryCapReached(
    city: string | null,
    targetDateIso: string | null,
    strategyId: string | null,
    maxEntries: number,
  ): boolean {
    if (!city || !targetDateIso || maxEntries <= 0) return false;
    const count = this.cityDateEntryCounts.get(reentryKey(city, targetDateIso, strategyId)) ?? 0;
    return count >= maxEntries;
  }

  noteEntry(city: string | null, targetDateIso: string | null, strategyId: string | null): void {
    if (!city || !targetDateIso) return;
    const key = reentryKey(city, targetDateIso, strategyId);
    this.cityDateEntryCounts.set(key, (this.cityDateEntryCounts.get(key) ?? 0) + 1);
  }

  /**
   * Evaluate exit conditions for an open position against the current
   * market state. Returns null when no exit should occur.
   *
   * The strategy params bag is resolved per-position from `pos.meta.strategyId`
   * so runner-sim multi-strategy runs use each position's own exit config.
   */
  evaluate(
    pos: LedgerPosition,
    input: {
      yesPrice: number;
      currentMean: number | null;
      now: Date;
      slippageBps: number;
      entryMean: number | null;
      entryBucketComparison: string | null;
      entryBucketBounds: { low?: number | null; high?: number | null; target?: number | null } | null;
      risk: WeatherConfig;
      strategyEnv: 'sim' | 'real';
    },
  ): ExitDecision | null {
    const now = input.now;
    const strategyId = (pos.meta.strategyId as string | undefined) ?? null;
    const bag = strategyId
      ? getStrategyParamsForMode(input.risk, strategyId, input.strategyEnv)
      : DEFAULT_WEATHER_STRATEGY_PARAMS;

    let drift = false;
    let bucketExit = false;
    if (input.currentMean != null && input.entryMean != null) {
      drift = shouldCloseForForecastDrift(
        input.entryMean,
        input.currentMean,
        bag.forecastChangeThreshold,
      );
    }

    if (!drift && input.entryBucketComparison && input.entryBucketBounds) {
      const leftBucket = shouldCloseForBucketExit(
        input.entryBucketComparison as 'exact' | 'between' | 'or_below' | 'or_above',
        input.entryBucketBounds,
        input.currentMean ?? Number.NaN,
      );
      const switchMode = resolveCityFollowSwitchMode(bag.cityFollowSwitchMode);
      const hysteresisPolls = bag.bucketHysteresisPolls;
      const pollMs = input.risk.weatherAlgoPollMs;

      if (!leftBucket) {
        this.bucketHysteresis.delete(pos.conditionId);
        this.lastHysteresisAdvanceAt.delete(pos.conditionId);
      } else {
        const lastAdvance = this.lastHysteresisAdvanceAt.get(pos.conditionId);
        const canAdvance =
          lastAdvance == null || now.getTime() - lastAdvance >= pollMs;
        if (canAdvance) {
          const consecutive = (this.bucketHysteresis.get(pos.conditionId) ?? 0) + 1;
          this.bucketHysteresis.set(pos.conditionId, consecutive);
          this.lastHysteresisAdvanceAt.set(pos.conditionId, now.getTime());
          bucketExit =
            switchMode === 'close_and_reenter' &&
            shouldEmitBucketExit(switchMode, true, consecutive, hysteresisPolls);
        } else {
          const consecutive = this.bucketHysteresis.get(pos.conditionId) ?? 0;
          bucketExit =
            switchMode === 'close_and_reenter' &&
            shouldEmitBucketExit(switchMode, true, consecutive, hysteresisPolls);
        }
      }
    }

    if (!drift && !bucketExit) return null;

    const reason: BacktestExitReason = drift
      ? 'WEATHER_FORECAST_CHANGE'
      : 'WEATHER_BUCKET_EXIT';
    const { exitPrice, fees } = simulateWeatherExitFill({
      qty: pos.qty,
      yesPrice: input.yesPrice,
      slippageBps: input.slippageBps,
    });
    if (pos.city) {
      this.markReentryBlocked(
        pos.city,
        pos.targetDateIso,
        now,
        strategyId,
        bag.reentryThrottleMs,
      );
    }
    this.bucketHysteresis.delete(pos.conditionId);
    this.lastHysteresisAdvanceAt.delete(pos.conditionId);
    return { reason, exitPrice, fees };
  }

  /**
   * SL/TP/Trailing using thresholds resolved at entry and stored on
   * `pos.meta` (via resolveWeatherEntryExitParams). Null = leg disabled.
   */
  evaluateSlTpTrailing(
    pos: LedgerPosition,
    input: {
      yesPrice: number;
      now: Date;
      slippageBps: number;
    },
  ): ExitDecision | null {
    const bid = input.yesPrice;
    const entry = pos.entryPrice;
    const slPercent = readResolvedPercent(pos.meta, 'slPercent');
    const tpPercent = readResolvedPercent(pos.meta, 'tpPercent');
    const trailingPercent = readResolvedPercent(pos.meta, 'trailingPercent');
    const trailingActivationPercent = readResolvedPercent(
      pos.meta,
      'trailingActivationPercent',
    );

    const costBasis = pos.qty > 0 ? entry + pos.fees / pos.qty : 0;
    const closurePnl = costBasis > 0 ? ((bid - costBasis) / costBasis) * 100 : 0;
    // Market-move PnL without fees — mirrors live `effectiveTrigger` guard on TP.
    const triggerPnl = entry > 0 ? ((bid - entry) / entry) * 100 : 0;

    if (slPercent != null && slPercent > 0 && closurePnl <= -slPercent + CLOSURE_PNL_EPSILON) {
      const { exitPrice, fees } = simulateWeatherExitFill({
        qty: pos.qty,
        yesPrice: input.yesPrice,
        slippageBps: input.slippageBps,
      });
      return { reason: 'SL', exitPrice, fees };
    }

    if (tpPercent != null && tpPercent > 0 && triggerPnl >= 0 && closurePnl >= tpPercent - CLOSURE_PNL_EPSILON) {
      const { exitPrice, fees } = simulateWeatherExitFill({
        qty: pos.qty,
        yesPrice: input.yesPrice,
        slippageBps: input.slippageBps,
      });
      return { reason: 'TP', exitPrice, fees };
    }

    if (trailingPercent != null && trailingPercent > 0) {
      const armed =
        trailingActivationPercent == null ||
        closurePnl >= trailingActivationPercent - CLOSURE_PNL_EPSILON;
      if (armed && pos.peakClosurePnl - closurePnl >= trailingPercent - CLOSURE_PNL_EPSILON) {
        const { exitPrice, fees } = simulateWeatherExitFill({
          qty: pos.qty,
          yesPrice: input.yesPrice,
          slippageBps: input.slippageBps,
        });
        return { reason: 'TRAILING', exitPrice, fees };
      }
    }

    return null;
  }
}
