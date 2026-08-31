import pino from 'pino';
import type { MarketListItemDto, WeatherStrategyParamsBag } from '@polywatch/core';
import type {
  WeatherStrategy,
  WeatherEvaluationContext,
  WeatherEvaluationResult,
} from './strategy.js';
import { DEFAULT_MIN_EDGE } from '../constants.js';
import { evaluateBucketGate } from './evaluate-bucket-gate.js';
import { pickBestEdgeBucket } from './bucket-selection.js';

const log = pino({ name: 'weather-algo:forecast-strategy' });

/**
 * Value-bet strategy: evaluates all active buckets and picks the one with
 * the highest YES edge (pickBestEdgeBucket). This is the live default.
 */
export class WeatherForecastStrategy implements WeatherStrategy {
  readonly id = 'weather-forecast';
  private minEdge: number = DEFAULT_MIN_EDGE;
  private maxForecastStd: number | null = null;
  private minForecastProbability: number | null = null;
  private minYesPrice: number | null = null;

  setMinEdge(edge: number): void {
    this.minEdge = edge;
  }

  setMaxForecastStd(maxStd: number | null): void {
    this.maxForecastStd = maxStd;
  }

  setMinForecastProbability(minProb: number | null): void {
    this.minForecastProbability = minProb;
  }

  setMinYesPrice(minPrice: number | null): void {
    this.minYesPrice = minPrice;
  }

  setRiskConfig(params: WeatherStrategyParamsBag): void {
    this.setMinEdge(params.minEdge);
    this.setMaxForecastStd(params.maxForecastStd);
    this.setMinForecastProbability(params.minForecastProbability);
    this.setMinYesPrice(params.minYesPrice);
  }

  private gateOptions() {
    return {
      strategyId: this.id,
      minEdge: this.minEdge,
      maxForecastStd: this.maxForecastStd,
      minForecastProbability: this.minForecastProbability,
      minYesPrice: this.minYesPrice,
    };
  }

  async evaluate(
    market: MarketListItemDto,
    ctx: WeatherEvaluationContext,
    now?: Date,
  ): Promise<WeatherEvaluationResult> {
    const result = await evaluateBucketGate(market, ctx, this.gateOptions(), now);
    if (result.kind === 'signal') {
      log.debug(
        {
          conditionId: market.conditionId,
          edge: result.signal.edge,
          threshold: result.signal.dynamicMinEdge,
        },
        'weather forecast strategy emitted signal',
      );
    }
    return result;
  }

  async evaluateGroup(
    markets: MarketListItemDto[],
    ctx: WeatherEvaluationContext,
    now?: Date,
  ): Promise<WeatherEvaluationResult> {
    const candidates: Extract<WeatherEvaluationResult, { kind: 'signal' }>['signal'][] = [];
    let lastAbstain: WeatherEvaluationResult = { kind: 'abstain', reason: 'no_buckets' };

    for (const market of markets) {
      const result = await this.evaluate(market, ctx, now);
      if (result.kind === 'signal') {
        candidates.push(result.signal);
      } else {
        lastAbstain = result;
      }
    }

    if (candidates.length === 0) {
      return lastAbstain;
    }

    const best = pickBestEdgeBucket(candidates, ctx.forecastMean);
    return { kind: 'signal', signal: best };
  }
}
