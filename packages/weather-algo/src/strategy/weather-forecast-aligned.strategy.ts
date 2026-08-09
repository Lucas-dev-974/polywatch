import pino from 'pino';
import type { MarketListItemDto, WeatherConfig } from '@polywatch/core';
import {
  parseWeatherQuestion,
  selectForecastAlignedBucket,
  type BucketCandidate,
} from '@polywatch/core';
import type {
  WeatherStrategy,
  WeatherEvaluationContext,
  WeatherEvaluationResult,
} from './strategy.js';
import { WEATHER_FORECAST_ALIGNED_STRATEGY_ID } from '@polywatch/core';
import { DEFAULT_MIN_EDGE } from '../constants.js';
import { evaluateBucketGate } from './evaluate-bucket-gate.js';

const log = pino({ name: 'weather-algo:forecast-aligned-strategy' });

/**
 * Directional strategy: selects the bucket whose range contains the forecast
 * mean (selectForecastAlignedBucket), then applies standard edge gates.
 */
export class WeatherForecastAlignedStrategy implements WeatherStrategy {
  readonly id = WEATHER_FORECAST_ALIGNED_STRATEGY_ID;
  private minEdge: number = DEFAULT_MIN_EDGE;
  private maxForecastStd: number | null = null;
  private minForecastProbability: number | null = null;

  setRiskConfig(risk: WeatherConfig): void {
    this.minEdge = risk.weatherAlgoMinEdge;
    this.maxForecastStd = risk.weatherAlgoMaxForecastStd;
    this.minForecastProbability = risk.weatherAlgoMinForecastProbability;
  }

  private gateOptions() {
    return {
      strategyId: this.id,
      minEdge: this.minEdge,
      maxForecastStd: this.maxForecastStd,
      minForecastProbability: this.minForecastProbability,
    };
  }

  async evaluate(
    market: MarketListItemDto,
    ctx: WeatherEvaluationContext,
    now?: Date,
  ): Promise<WeatherEvaluationResult> {
    return evaluateBucketGate(market, ctx, this.gateOptions(), now);
  }

  async evaluateGroup(
    markets: MarketListItemDto[],
    ctx: WeatherEvaluationContext,
    now?: Date,
  ): Promise<WeatherEvaluationResult> {
    const buckets: BucketCandidate[] = [];
    for (const market of markets) {
      if (!market.question) continue;
      const parsed = parseWeatherQuestion(market.question);
      if (!parsed) continue;
      buckets.push({ conditionId: market.conditionId, market, parsed });
    }

    if (buckets.length === 0) {
      return { kind: 'abstain', reason: 'no_buckets' };
    }

    const selected = selectForecastAlignedBucket(ctx.forecastMean, buckets);
    if (!selected) {
      return {
        kind: 'abstain',
        reason: 'no_aligned_bucket',
        detail: `forecastMean=${ctx.forecastMean.toFixed(2)} not in any bucket`,
      };
    }

    const result = await evaluateBucketGate(selected.market, ctx, this.gateOptions(), now);
    if (result.kind === 'signal') {
      log.debug(
        {
          conditionId: selected.conditionId,
          edge: result.signal.edge,
          comparison: selected.parsed.comparison,
        },
        'weather forecast-aligned strategy emitted signal',
      );
    }
    return result;
  }
}
