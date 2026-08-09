import type { WeatherStrategy } from './strategy.js';
import { WeatherForecastStrategy } from './weather-forecast.strategy.js';
import { WeatherForecastAlignedStrategy } from './weather-forecast-aligned.strategy.js';
import {
  WEATHER_STRATEGY_CATALOG,
  type WeatherStrategyId,
} from '@polywatch/core';

export type { WeatherStrategy, WeatherSignal, WeatherEvaluationContext, WeatherEvaluationResult } from './strategy.js';

export class WeatherStrategyRegistry {
  private strategies = new Map<string, WeatherStrategy>();

  register(strategy: WeatherStrategy): void {
    this.strategies.set(strategy.id, strategy);
  }

  get(id: string): WeatherStrategy | undefined {
    return this.strategies.get(id);
  }

  getAll(): WeatherStrategy[] {
    return Array.from(this.strategies.values());
  }

  /** Strategies in catalogue order, filtered to registered IDs. */
  getOrdered(enabledIds: WeatherStrategyId[]): WeatherStrategy[] {
    const enabled = new Set(enabledIds);
    const result: WeatherStrategy[] = [];
    for (const meta of WEATHER_STRATEGY_CATALOG) {
      if (!enabled.has(meta.id)) continue;
      const s = this.strategies.get(meta.id);
      if (s) result.push(s);
    }
    return result;
  }
}

export { WeatherForecastStrategy, WeatherForecastAlignedStrategy };
