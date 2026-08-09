import {
  WeatherForecastStrategy,
  type WeatherEvaluationContext,
  type WeatherEvaluationResult,
} from '@polywatch/weather-algo';
import type { MarketListItemDto } from '@polywatch/core';

/**
 * Wraps the live WeatherForecastStrategy so that `hoursToResolution` is
 * computed against the backtest's virtual clock instead of Date.now().
 *
 * The live evaluate() now accepts an optional `now` parameter (falling back
 * to Date.now() when omitted), so no global monkey-patching is needed. The
 * backtest passes ctx.clock.now() explicitly for determinism.
 */
export class ClockedWeatherForecastStrategy extends WeatherForecastStrategy {
  async evaluateAt(
    market: MarketListItemDto,
    ctx: WeatherEvaluationContext,
    now: Date,
  ): Promise<WeatherEvaluationResult> {
    return super.evaluate(market, ctx, now);
  }
}
