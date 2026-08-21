import {
  type WeatherConfig,
  shouldCloseForForecastDrift,
  shouldCloseForBucketExit,
  shouldEmitBucketExit,
  resolveCityFollowSwitchMode,
  getStrategyParams,
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

/** Clé de throttle ré-entrée : stratifiée par stratégie pour ne pas croiser les stratégies. */
function reentryKey(city: string, targetDateIso: string, strategyId: string | null): string {
  return `${city}|${targetDateIso}|${strategyId ?? 'default'}`;
}

function readResolvedBidPoints(
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
 * - SL/TP/trailing use thresholds resolved at entry (meta.*BidPoints)
 */
export class WeatherExitManager {
  /** positionId (conditionId) -> consecutive out-of-bucket polls. */
  private bucketHysteresis = new Map<string, number>();
  /** positionId -> last virtual time hysteresis was advanced. */
  private lastHysteresisAdvanceAt = new Map<string, number>();
  /** `city|dateIso|strategyId` -> last close timestamp (re-entry throttle). */
  private reentryThrottle = new Map<string, number>();

  isReentryBlocked(
    city: string,
    targetDateIso: string | null,
    now: Date,
    risk: WeatherConfig,
    strategyId: string | null,
  ): boolean {
    if (!targetDateIso) return false;
    const last = this.reentryThrottle.get(reentryKey(city, targetDateIso, strategyId));
    if (last == null) return false;
    const bag = strategyId
      ? getStrategyParams(risk, strategyId)
      : DEFAULT_WEATHER_STRATEGY_PARAMS;
    return now.getTime() - last < bag.reentryThrottleMs;
  }

  /** Throttle une ville/date pour une stratégie donnée (résolution et sorties drift/bucket). */
  markClosed(city: string, targetDateIso: string | null, now: Date, strategyId: string | null): void {
    if (!targetDateIso) return;
    this.reentryThrottle.set(reentryKey(city, targetDateIso, strategyId), now.getTime());
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
    },
  ): ExitDecision | null {
    const now = input.now;
    const strategyId = (pos.meta.strategyId as string | undefined) ?? null;
    const bag = strategyId
      ? getStrategyParams(input.risk, strategyId)
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
      this.markClosed(pos.city, pos.targetDateIso, now, strategyId);
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
    const slBidPoints = readResolvedBidPoints(pos.meta, 'slBidPoints');
    const tpBidPoints = readResolvedBidPoints(pos.meta, 'tpBidPoints');
    const trailingBidPoints = readResolvedBidPoints(pos.meta, 'trailingBidPoints');
    const trailingActivationBidPoints = readResolvedBidPoints(
      pos.meta,
      'trailingActivationBidPoints',
    );

    if (slBidPoints != null) {
      const slBidAbsolute = entry - slBidPoints;
      if (bid <= slBidAbsolute) {
        const { exitPrice, fees } = simulateWeatherExitFill({
          qty: pos.qty,
          yesPrice: input.yesPrice,
          slippageBps: input.slippageBps,
        });
        return { reason: 'SL', exitPrice, fees };
      }
    }

    if (tpBidPoints != null) {
      const tpBidAbsolute = Math.min(entry + tpBidPoints, 1);
      if (bid >= tpBidAbsolute) {
        const { exitPrice, fees } = simulateWeatherExitFill({
          qty: pos.qty,
          yesPrice: input.yesPrice,
          slippageBps: input.slippageBps,
        });
        return { reason: 'TP', exitPrice, fees };
      }
    }

    if (trailingBidPoints != null && trailingBidPoints > 0) {
      const armed =
        trailingActivationBidPoints == null ||
        bid >= entry + trailingActivationBidPoints;
      if (armed && pos.peakBid - bid >= trailingBidPoints) {
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
