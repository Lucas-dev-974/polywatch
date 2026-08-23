import type { MarketListItemDto } from '@polywatch/core';
import type {
  WeatherStrategy,
  WeatherEvaluationContext,
  WeatherEvaluationResult,
} from '@polywatch/weather-algo';
import {
  WeatherForecastStrategy,
  WeatherForecastAlignedStrategy,
  WeatherHighestYesStrategy,
} from '@polywatch/weather-algo';
import {
  WEATHER_FORECAST_STRATEGY_ID,
  WEATHER_FORECAST_ALIGNED_STRATEGY_ID,
  WEATHER_HIGHEST_YES_STRATEGY_ID,
  type WeatherStrategyId,
} from '@polywatch/core';

/**
 * Wraps a live WeatherStrategy so `hoursToResolution` uses the backtest clock.
 */
export class ClockedWeatherStrategy implements WeatherStrategy {
  readonly id: string;

  constructor(private readonly inner: WeatherStrategy) {
    this.id = inner.id;
  }

  setRiskConfig(risk: Parameters<NonNullable<WeatherStrategy['setRiskConfig']>>[0]): void {
    this.inner.setRiskConfig?.(risk);
  }

  async evaluateAt(
    market: MarketListItemDto,
    ctx: WeatherEvaluationContext,
    now: Date,
  ): Promise<WeatherEvaluationResult> {
    return this.inner.evaluate(market, ctx, now);
  }

  // Required by the WeatherStrategy interface; the backtest adapter uses
  // evaluateAt/evaluateGroup only (never evaluate directly).
  // Required by the WeatherStrategy interface; the backtest adapter uses
  // evaluateAt/evaluateGroup only.
  // Required by the WeatherStrategy interface; the backtest adapter uses
  // evaluateAt/evaluateGroup only.
  // Required by the WeatherStrategy interface; the backtest adapter only uses
  // evaluateAt/evaluateGroup. Kept for contract compliance.
  async evaluate(
    market: MarketListItemDto,
    ctx: WeatherEvaluationContext,
    now?: Date,
  ): Promise<WeatherEvaluationResult> {
    return this.inner.evaluate(market, ctx, now);
  }

  async evaluateGroup?(
    markets: MarketListItemDto[],
    ctx: WeatherEvaluationContext,
    now?: Date,
  ): Promise<WeatherEvaluationResult> {
    if (this.inner.evaluateGroup) {
      return this.inner.evaluateGroup(markets, ctx, now);
    }
    return { kind: 'abstain', reason: 'no_group_evaluator' };
  }
}

export function createWeatherStrategy(strategyId: WeatherStrategyId): ClockedWeatherStrategy {
  switch (strategyId) {
    case WEATHER_FORECAST_ALIGNED_STRATEGY_ID:
      return new ClockedWeatherStrategy(new WeatherForecastAlignedStrategy());
    case WEATHER_HIGHEST_YES_STRATEGY_ID:
      return new ClockedWeatherStrategy(new WeatherHighestYesStrategy());
    case WEATHER_FORECAST_STRATEGY_ID:
    default:
      return new ClockedWeatherStrategy(new WeatherForecastStrategy());
  }
}
