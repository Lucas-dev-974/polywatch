import pino from 'pino';
import type { MarketListItemDto } from '@polywatch/core';
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

const log = pino({ name: 'weather-algo:forecast-strategy' });

/**
 * Weather forecast strategy: compares the forecast-implied probability
 * of a temperature outcome with the market price.
 *
 * For "or below" markets, YES = P(temp <= target).
 * For "or above" markets, YES = P(temp >= target).
 * For "exact" markets, YES = P(target - 0.5 < temp <= target + 0.5).
 *
 * If the market underprices the outcome, emit a BUY signal for that outcome.
 */
export class WeatherForecastStrategy implements WeatherStrategy {
  readonly id = 'weather-forecast';
  private minEdge: number = 0.10;
  private maxForecastStd: number | null = null;

  setMinEdge(edge: number): void {
    this.minEdge = edge;
  }

  setMaxForecastStd(maxStd: number | null): void {
    this.maxForecastStd = maxStd;
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

    // Compute forecast-implied YES and NO probabilities from the question semantics.
    const { yesProb: forecastYesProb, noProb: forecastNoProb } =
      computeMarketImpliedProbabilities(
        parsed.targetValue,
        parsed.comparison,
        ctx.forecastMean,
        ctx.forecastStdDev,
        parsed.targetValueLow,
        parsed.targetValueHigh,
      );

    if (forecastYesProb <= 0 && forecastNoProb <= 0) {
      return {
        kind: 'abstain',
        reason: 'zero_forecast_probability',
        detail: `target=${parsed.targetValue ?? `${parsed.targetValueLow}-${parsed.targetValueHigh}`} comparison=${parsed.comparison}`,
      };
    }

    // Skip markets where forecast uncertainty is too high (BUG-2 fix:
    // weatherAlgoMaxForecastStd was never checked)
    if (this.maxForecastStd != null && ctx.forecastStdDev > this.maxForecastStd) {
      return {
        kind: 'abstain',
        reason: 'forecast_too_uncertain',
        detail: `stdDev=${ctx.forecastStdDev.toFixed(2)} > max=${this.maxForecastStd}`,
      };
    }

    // Get market prices
    if (!market.outcomePrices || market.outcomePrices.length < 2) {
      return { kind: 'abstain', reason: 'no_market_prices' };
    }

    const yesPrice = market.outcomePrices[0]?.price ?? 0;
    const noPrice = market.outcomePrices[1]?.price ?? 0;

    if (yesPrice <= 0 && noPrice <= 0) {
      return { kind: 'abstain', reason: 'zero_prices' };
    }

    // Edge = forecast probability - market price
    // Positive edge means the market underprices that outcome.
    const yesEdge = calculateEdge(forecastYesProb, yesPrice);
    const noEdge = calculateEdge(forecastNoProb, noPrice);

    // Dynamic threshold based on uncertainty and time to resolution
    const hoursToResolution = market.endDate
      ? Math.max(0, (new Date(market.endDate).getTime() - Date.now()) / 3_600_000)
      : 24;
    const dynamicThreshold = resolveDynamicMinEdge(
      ctx.forecastStdDev,
      hoursToResolution,
      this.minEdge,
    );

    let candidate: { outcome: 'YES' | 'NO'; edge: number; marketPrice: number; forecastProb: number } | null = null;

    if (yesEdge > dynamicThreshold && yesEdge >= noEdge) {
      candidate = { outcome: 'YES', edge: yesEdge, marketPrice: yesPrice, forecastProb: forecastYesProb };
    } else if (noEdge > dynamicThreshold) {
      candidate = { outcome: 'NO', edge: noEdge, marketPrice: noPrice, forecastProb: forecastNoProb };
    }

    if (!candidate) {
      return {
        kind: 'abstain',
        reason: 'insufficient_edge',
        detail: `yesEdge=${yesEdge.toFixed(4)} noEdge=${noEdge.toFixed(4)} threshold=${dynamicThreshold.toFixed(4)}`,
      };
    }

    const assetId =
      candidate.outcome === 'YES' ? market.tokenIdYes : market.tokenIdNo;
    if (!assetId) {
      return { kind: 'abstain', reason: 'missing_token' };
    }

    const targetDate = market.endDate ? new Date(market.endDate) : new Date();

    const signal: WeatherSignal = {
      conditionId: market.conditionId,
      assetId,
      outcome: candidate.outcome,
      side: 'BUY',
      confidence: Math.min(1, Math.abs(candidate.edge) * 2),
      reasons: [
        `forecast=${parsed.metric}:${parsed.targetValue ?? `${parsed.targetValueLow}-${parsed.targetValueHigh}`}°C`,
        `comparison=${parsed.comparison}`,
        `forecastProb=${candidate.forecastProb.toFixed(4)}`,
        `marketPrice=${candidate.marketPrice.toFixed(4)}`,
        `edge=${candidate.edge.toFixed(4)}`,
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
      forecastProbability: candidate.forecastProb,
      marketPrice: candidate.marketPrice,
      edge: candidate.edge,
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
        outcome: candidate.outcome,
        edge: candidate.edge,
        threshold: dynamicThreshold,
      },
      'weather forecast strategy emitted signal',
    );

    return { kind: 'signal', signal };
  }
}