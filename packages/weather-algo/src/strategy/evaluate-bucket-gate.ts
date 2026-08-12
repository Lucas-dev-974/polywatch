import type { MarketListItemDto } from '@polywatch/core';
import {
  parseWeatherQuestion,
  calculateEdge,
  resolveDynamicMinEdge,
  computeMarketImpliedProbabilities,
  binaryPricesFromParsed,
  binaryPricesToUpDown,
} from '@polywatch/core';
import type { WeatherEvaluationContext, WeatherEvaluationResult, WeatherSignal } from './strategy.js';
import { DEFAULT_HOURS_TO_RESOLUTION_FALLBACK } from '../constants.js';

export type EvaluateBucketGateOptions = {
  strategyId: string;
  minEdge: number;
  maxForecastStd: number | null;
  minForecastProbability: number | null;
};

/**
 * Shared entry gates for forecast-based strategies (single bucket).
 */
export async function evaluateBucketGate(
  market: MarketListItemDto,
  ctx: WeatherEvaluationContext,
  opts: EvaluateBucketGateOptions,
  now?: Date,
): Promise<WeatherEvaluationResult> {
  const nowMs = now?.getTime() ?? Date.now();
  if (!market.question) {
    return { kind: 'abstain', reason: 'no_question' };
  }

  const parsed = parseWeatherQuestion(market.question);
  if (!parsed) {
    return { kind: 'abstain', reason: 'unrecognized_question' };
  }

  const { yesProb: forecastYesProb } = computeMarketImpliedProbabilities(
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
      forecastProb: 0,
    };
  }

  if (
    opts.minForecastProbability != null &&
    forecastYesProb < opts.minForecastProbability
  ) {
    return {
      kind: 'abstain',
      reason: 'forecast_probability_below_min',
      detail: `forecastProb=${forecastYesProb.toFixed(4)} < min=${opts.minForecastProbability.toFixed(4)}`,
      forecastProb: forecastYesProb,
    };
  }

  if (opts.maxForecastStd != null && ctx.forecastStdDev > opts.maxForecastStd) {
    return {
      kind: 'abstain',
      reason: 'forecast_too_uncertain',
      detail: `stdDev=${ctx.forecastStdDev.toFixed(2)} > max=${opts.maxForecastStd}`,
      forecastProb: forecastYesProb,
    };
  }

  const sidePrices = binaryPricesFromParsed(market.outcomePrices ?? []);
  const { upPrice: yesPrice } = binaryPricesToUpDown(sidePrices);

  if (yesPrice == null) {
    return { kind: 'abstain', reason: 'no_market_prices', forecastProb: forecastYesProb };
  }

  if (yesPrice <= 0) {
    return { kind: 'abstain', reason: 'zero_prices', forecastProb: forecastYesProb };
  }

  const yesEdge = calculateEdge(forecastYesProb, yesPrice);

  const hoursToResolution = market.endDate
    ? Math.max(0, (new Date(market.endDate).getTime() - nowMs) / 3_600_000)
    : DEFAULT_HOURS_TO_RESOLUTION_FALLBACK;
  const dynamicThreshold = resolveDynamicMinEdge(
    ctx.forecastStdDev,
    hoursToResolution,
    opts.minEdge,
  );

  if (yesEdge <= dynamicThreshold) {
    return {
      kind: 'abstain',
      reason: 'insufficient_edge',
      detail: `yesEdge=${yesEdge.toFixed(4)} threshold=${dynamicThreshold.toFixed(4)}`,
      forecastProb: forecastYesProb,
      edge: yesEdge,
      dynamicMinEdge: dynamicThreshold,
    };
  }

  const assetId = market.tokenIdYes;
  if (!assetId) {
    return {
      kind: 'abstain',
      reason: 'missing_token',
      forecastProb: forecastYesProb,
      edge: yesEdge,
      dynamicMinEdge: dynamicThreshold,
    };
  }

  const targetDate = market.endDate ? new Date(market.endDate) : new Date(nowMs);

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
    strategyId: opts.strategyId,
    eventSlug: market.eventSlug ?? market.conditionId,
    city: parsed.city,
    metric: parsed.metric,
    targetDate,
    forecastMean: ctx.forecastMean,
    forecastStdDev: ctx.forecastStdDev,
    forecastProbability: forecastYesProb,
    marketPrice: yesPrice,
    edge: yesEdge,
    dynamicMinEdge: dynamicThreshold,
    entryBucketComparison: parsed.comparison,
    entryBucketBounds: {
      low: parsed.targetValueLow,
      high: parsed.targetValueHigh,
      target: parsed.targetValue,
    },
    unit: parsed.unit,
  };

  return { kind: 'signal', signal };
}
