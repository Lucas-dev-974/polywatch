import type { WeatherStrategy } from './strategy.js';
import { WeatherForecastStrategy } from './weather-forecast.strategy.js';

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
}

export { WeatherForecastStrategy };