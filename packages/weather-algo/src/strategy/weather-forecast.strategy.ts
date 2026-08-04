import pino from 'pino';
import type { MarketListItemDto, WeatherConfig } from '@polywatch/core';
import {
  parseWeatherQuestion,
  calculateEdge,
  resolveDynamicMinEdge,
  computeMarketImpliedProbabilities,
} from '@polywatch/core';
import type {
  WeatherStrategy,
  WeatherSignal,
  WeatherEvaluationContext,
  WeatherEvaluationResult,
} from './strategy.js';
import { DEFAULT_MIN_EDGE, DEFAULT_HOURS_TO_RESOLUTION_FALLBACK } from '../constants.js';

const log = pino({ name: 'weather-algo:forecast-strategy' });

/**
 * Weather forecast strategy: compares the forecast-implied probability
 * of a temperature outcome with the market price.
 *
 * City-first: BUY YES only on the forecast-aligned bucket (directional thesis).
 */
export class WeatherForecastStrategy implements WeatherStrategy {
  readonly id = 'weather-forecast';
  private minEdge: number = DEFAULT_MIN_EDGE;
  private maxForecastStd: number | null = null;
  private minForecastProbability: number | null = null;

  setMinEdge(edge: number): void {
    this.minEdge = edge;
  }

  setMaxForecastStd(maxStd: number | null): void {
    this.maxForecastStd = maxStd;
  }

  setMinForecastProbability(minProb: number | null): void {
    this.minForecastProbability = minProb;
  }

  setRiskConfig(risk: WeatherConfig): void {
    this.setMinEdge(risk.weatherAlgoMinEdge);
    this.setMaxForecastStd(risk.weatherAlgoMaxForecastStd);
    this.setMinForecastProbability(risk.weatherAlgoMinForecastProbability);
  }

  async evaluate(
    market: MarketListItemDto,
    ctx: WeatherEvaluationContext,
  ): Promise<WeatherEvaluationResult> {
    if (!market.question) {
      return { kind: 'abstain', reason: 'no_question' };
    }

    const parsed = parseWeatherQuestion(market.question);
    if (!parsed) {
      return { kind: 'abstain', reason: 'unrecognized_question' };
    }

    const { yesProb: forecastYesProb } =
      computeMarketImpliedProbabilities(
        parsed.targetValue,
        parsed.comparison,
        ctx.forecastMean,
        ctx.forecastStdDev,
        parsed.targetValueLow,
        parsed.targetValueHigh,
      );

    if (forecastYesProb <= 0) {
      return {
        kind: 'abstain',
        reason: 'zero_forecast_probability',
        detail: `target=${parsed.targetValue ?? `${parsed.targetValueLow}-${parsed.targetValueHigh}`} comparison=${parsed.comparison}`,
      };
    }

    // Filter long-shot buckets: a low forecastProb (e.g. 0.15) can pass the
    // probability-edge gate (edge = forecastProb - marketPrice ≥ minEdge) yet
    // resolve YES only ~15% of the time — structurally producing a near-0%
    // win rate. Require a directional thesis (forecastProb ≥ min) unless the
    // filter is disabled (null).
    if (
      this.minForecastProbability != null &&
      forecastYesProb < this.minForecastProbability
    ) {
      return {
        kind: 'abstain',
        reason: 'forecast_probability_below_min',
        detail: `forecastProb=${forecastYesProb.toFixed(4)} < min=${this.minForecastProbability.toFixed(4)}`,
      };
    }

    if (this.maxForecastStd != null && ctx.forecastStdDev > this.maxForecastStd) {
      return {
        kind: 'abstain',
        reason: 'forecast_too_uncertain',
        detail: `stdDev=${ctx.forecastStdDev.toFixed(2)} > max=${this.maxForecastStd}`,
      };
    }

    if (!market.outcomePrices || market.outcomePrices.length < 2) {
      return { kind: 'abstain', reason: 'no_market_prices' };
    }

    const yesPrice = market.outcomePrices[0]?.price ?? 0;

    if (yesPrice <= 0) {
      return { kind: 'abstain', reason: 'zero_prices' };
    }

    const yesEdge = calculateEdge(forecastYesProb, yesPrice);

    const hoursToResolution = market.endDate
      ? Math.max(0, (new Date(market.endDate).getTime() - Date.now()) / 3_600_000)
      : DEFAULT_HOURS_TO_RESOLUTION_FALLBACK;
    const dynamicThreshold = resolveDynamicMinEdge(
      ctx.forecastStdDev,
      hoursToResolution,
      this.minEdge,
    );

    if (yesEdge <= dynamicThreshold) {
      return {
        kind: 'abstain',
        reason: 'insufficient_edge',
        detail: `yesEdge=${yesEdge.toFixed(4)} threshold=${dynamicThreshold.toFixed(4)}`,
      };
    }

    const assetId = market.tokenIdYes;
    if (!assetId) {
      return { kind: 'abstain', reason: 'missing_token' };
    }

    const targetDate = market.endDate ? new Date(market.endDate) : new Date();

    const signal: WeatherSignal = {
      conditionId: market.conditionId,
      assetId,
      outcome: 'YES',
      side: 'BUY',
      confidence: Math.min(1, Math.abs(yesEdge) * 2),
      reasons: [
        `forecast=${parsed.metric}:${parsed.targetValue ?? `${parsed.targetValueLow}-${parsed.targetValueHigh}`}°C`,
        `comparison=${parsed.comparison}`,
        `forecastProb=${forecastYesProb.toFixed(4)}`,
        `marketPrice=${yesPrice.toFixed(4)}`,
        `edge=${yesEdge.toFixed(4)}`,
        `threshold=${dynamicThreshold.toFixed(4)}`,
        `stdDev=${ctx.forecastStdDev.toFixed(2)}`,
        `hoursToResolution=${hoursToResolution.toFixed(1)}`,
      ],
      strategyId: this.id,
      eventSlug: market.eventSlug ?? market.conditionId,
      city: parsed.city,
      metric: parsed.metric,
      targetDate,
      forecastMean: ctx.forecastMean,
      forecastStdDev: ctx.forecastStdDev,
      forecastProbability: forecastYesProb,
      marketPrice: yesPrice,
      edge: yesEdge,
      entryBucketComparison: parsed.comparison,
      entryBucketBounds: {
        low: parsed.targetValueLow,
        high: parsed.targetValueHigh,
        target: parsed.targetValue,
      },
    };

    log.debug(
      {
        conditionId: market.conditionId,
        outcome: 'YES',
        edge: yesEdge,
        threshold: dynamicThreshold,
      },
      'weather forecast strategy emitted signal',
    );

    return { kind: 'signal', signal };
  }
}
