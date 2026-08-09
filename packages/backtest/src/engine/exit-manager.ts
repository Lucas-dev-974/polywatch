import {
  type WeatherConfig,
  shouldCloseForForecastDrift,
  shouldCloseBeforeResolution,
  shouldCloseForBucketExit,
  shouldEmitBucketExit,
  resolveCityFollowSwitchMode,
  type BacktestExitReason,
} from '@polywatch/core';
import { type LedgerPosition } from './ledger.js';
import { simulateWeatherExitFill } from './fill-engine.js';

export interface ExitDecision {
  reason: BacktestExitReason;
  exitPrice: number;
  fees: number;
}

/**
 * Weather exit rules evaluated purely in-memory at each book tick that
 * touches an open position. The live WeatherExitEvaluator is Redis/network
 * coupled, so this mirrors its behaviour with a local hysteresis map.
 */
export class WeatherExitManager {
  /** positionId (conditionId) -> consecutive out-of-bucket polls. */
  private bucketHysteresis = new Map<string, number>();
  /** city -> last close timestamp (re-entry throttle). */
  private reentryThrottle = new Map<string, number>();

  constructor(private readonly risk: WeatherConfig) {}

  isReentryBlocked(city: string, now: Date): boolean {
    const last = this.reentryThrottle.get(city);
    if (last == null) return false;
    const throttleMs = this.risk.weatherAlgoReentryThrottleMs ?? 1_800_000;
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
    const risk = this.risk;
    const now = input.now;

    const closeBeforeHours = risk.weatherAlgoCloseBeforeResolutionHours ?? 1;
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
      this.markClosed(pos.city ?? '', now);
      return { reason: 'WEATHER_PRE_CLOSE', exitPrice, fees };
    }

    let drift = false;
    let bucketExit = false;
    if (input.currentMean != null && input.entryMean != null) {
      drift = shouldCloseForForecastDrift(
        input.entryMean,
        input.currentMean,
        risk.weatherAlgoForecastChangeThreshold ?? 2,
      );
    }

    if (!drift && input.entryBucketComparison && input.entryBucketBounds) {
      const leftBucket = shouldCloseForBucketExit(
        input.entryBucketComparison as 'exact' | 'between' | 'or_below' | 'or_above',
        input.entryBucketBounds,
        input.currentMean ?? Number.NaN,
      );
      const switchMode = resolveCityFollowSwitchMode(risk.weatherAlgoCityFollowSwitchMode);
      const hysteresisPolls = risk.weatherAlgoBucketHysteresisPolls ?? 2;

      if (!leftBucket) {
        this.bucketHysteresis.delete(pos.conditionId);
      } else {
        const consecutive = (this.bucketHysteresis.get(pos.conditionId) ?? 0) + 1;
        this.bucketHysteresis.set(pos.conditionId, consecutive);
        bucketExit =
          switchMode === 'close_and_reenter' &&
          shouldEmitBucketExit(switchMode, true, consecutive, hysteresisPolls);
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
    return { reason, exitPrice, fees };
  }

  /**
   * SL/TP/Trailing exit decision using the config thresholds resolved at
   * entry (weatherAlgoSlBidPoints etc). Mirrors evaluateSlTpTrailing for a
   * buy-YES position where thresholds are bid offsets from entry.
   */
  evaluateSlTpTrailing(
    pos: LedgerPosition,
    input: {
      yesPrice: number;
      now: Date;
      slippageBps: number;
    },
  ): ExitDecision | null {
    const risk = this.risk;
    const bid = input.yesPrice;
    const entry = pos.entryPrice;

    if (risk.weatherAlgoSlEnabled !== false && risk.weatherAlgoSlBidPoints != null) {
      const slBidAbsolute = entry - risk.weatherAlgoSlBidPoints;
      if (bid <= slBidAbsolute) {
        const { exitPrice, fees } = simulateWeatherExitFill({
          qty: pos.qty,
          yesPrice: input.yesPrice,
          slippageBps: input.slippageBps,
        });
        this.markClosed(pos.city ?? '', input.now);
        return { reason: 'SL', exitPrice, fees };
      }
    }

    if (risk.weatherAlgoTpEnabled !== false && risk.weatherAlgoTpBidPoints != null) {
      const tpBidAbsolute = Math.min(entry + risk.weatherAlgoTpBidPoints, 1);
      if (bid >= tpBidAbsolute) {
        const { exitPrice, fees } = simulateWeatherExitFill({
          qty: pos.qty,
          yesPrice: input.yesPrice,
          slippageBps: input.slippageBps,
        });
        this.markClosed(pos.city ?? '', input.now);
        return { reason: 'TP', exitPrice, fees };
      }
    }

    if (
      risk.weatherAlgoTrailingEnabled !== false &&
      risk.weatherAlgoTrailingBidPoints != null &&
      risk.weatherAlgoTrailingBidPoints > 0
    ) {
      const armed =
        risk.weatherAlgoTrailingActivationBidPoints == null ||
        bid >= entry + risk.weatherAlgoTrailingActivationBidPoints;
      if (armed && pos.peakBid - bid >= risk.weatherAlgoTrailingBidPoints) {
        const { exitPrice, fees } = simulateWeatherExitFill({
          qty: pos.qty,
          yesPrice: input.yesPrice,
          slippageBps: input.slippageBps,
        });
        this.markClosed(pos.city ?? '', input.now);
        return { reason: 'TRAILING', exitPrice, fees };
      }
    }

    return null;
  }
}
