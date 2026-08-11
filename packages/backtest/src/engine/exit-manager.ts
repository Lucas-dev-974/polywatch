import {
  type WeatherConfig,
  shouldCloseForForecastDrift,
  shouldCloseBeforeResolution,
  shouldCloseForBucketExit,
  shouldEmitBucketExit,
  resolveCityFollowSwitchMode,
  getStrategyParams,
  DEFAULT_WEATHER_STRATEGY_PARAMS,
  type WeatherStrategyParamsBag,
  type BacktestExitReason,
} from '@polywatch/core';
import { type LedgerPosition } from './ledger.js';
import { simulateWeatherExitFill } from './fill-engine.js';

export interface ExitDecision {
  reason: BacktestExitReason;
  exitPrice: number;
  fees: number;
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
 * - re-entry throttle only for bucket/drift exits
 * - bucket hysteresis advances at most once per weatherAlgoPollMs
 * - SL/TP/trailing use thresholds resolved at entry (meta.*BidPoints)
 */
export class WeatherExitManager {
  /** positionId (conditionId) -> consecutive out-of-bucket polls. */
  private bucketHysteresis = new Map<string, number>();
  /** positionId -> last virtual time hysteresis was advanced. */
  private lastHysteresisAdvanceAt = new Map<string, number>();
  /** city -> last close timestamp (re-entry throttle). */
  private reentryThrottle = new Map<string, number>();
  private readonly bag: WeatherStrategyParamsBag;

  constructor(private readonly risk: WeatherConfig, strategyId?: string | null) {
    this.bag = strategyId
      ? getStrategyParams(risk, strategyId)
      : DEFAULT_WEATHER_STRATEGY_PARAMS;
  }

  isReentryBlocked(city: string, now: Date): boolean {
    const last = this.reentryThrottle.get(city);
    if (last == null) return false;
    const throttleMs = this.bag.reentryThrottleMs;
    return now.getTime() - last < throttleMs;
  }

  private markClosed(city: string, now: Date): void {
    this.reentryThrottle.set(city, now.getTime());
  }

  /**
   * Evaluate exit conditions for an open position against the current
   * market state. Returns null when no exit should occur.
   */
  evaluate(
    pos: LedgerPosition,
    input: {
      yesPrice: number;
      endDate: Date | null;
      currentMean: number | null;
      now: Date;
      slippageBps: number;
      entryMean: number | null;
      entryBucketComparison: string | null;
      entryBucketBounds: { low?: number | null; high?: number | null; target?: number | null } | null;
    },
  ): ExitDecision | null {
    const now = input.now;

    const closeBeforeHours = this.bag.closeBeforeResolutionHours;
    // Negative hoursToEnd (endDate already past) is intentional: the helper
    // treats hoursToEnd <= closeBeforeHours as pre-close (see R3 follow-up).
    let hoursToEnd = Number.POSITIVE_INFINITY;
    if (input.endDate) {
      hoursToEnd = (input.endDate.getTime() - now.getTime()) / 3_600_000;
    }
    if (shouldCloseBeforeResolution(hoursToEnd, closeBeforeHours)) {
      const { exitPrice, fees } = simulateWeatherExitFill({
        qty: pos.qty,
        yesPrice: input.yesPrice,
        slippageBps: input.slippageBps,
      });
      return { reason: 'WEATHER_PRE_CLOSE', exitPrice, fees };
    }

    let drift = false;
    let bucketExit = false;
    if (input.currentMean != null && input.entryMean != null) {
      drift = shouldCloseForForecastDrift(
        input.entryMean,
        input.currentMean,
        this.bag.forecastChangeThreshold,
      );
    }

    if (!drift && input.entryBucketComparison && input.entryBucketBounds) {
      const leftBucket = shouldCloseForBucketExit(
        input.entryBucketComparison as 'exact' | 'between' | 'or_below' | 'or_above',
        input.entryBucketBounds,
        input.currentMean ?? Number.NaN,
      );
      const switchMode = resolveCityFollowSwitchMode(this.bag.cityFollowSwitchMode);
      const hysteresisPolls = this.bag.bucketHysteresisPolls;
      const pollMs = this.risk.weatherAlgoPollMs;

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
    this.markClosed(pos.city ?? '', now);
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
