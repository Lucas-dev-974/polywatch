import type { MarketListItemDto } from '@polywatch/core';

export interface WeatherSignal {
  conditionId: string;
  assetId: string;
  outcome: 'YES' | 'NO';
  side: 'BUY';
  confidence: number;
  reasons: string[];
  strategyId: string;
  eventSlug: string;
  forecastMean: number;
  forecastStdDev: number;
  forecastProbability: number;
  marketPrice: number;
  edge: number;
}

export interface WeatherEvaluationContext {
  forecastMean: number;
  forecastStdDev: number;
  /** Probability distribution over temperature outcomes for the event. */
  tempDistribution: Map<number, number>;
}

export type WeatherEvaluationResult =
  | { kind: 'signal'; signal: WeatherSignal }
  | { kind: 'abstain'; reason: string; detail?: string };

export interface WeatherStrategy {
  readonly id: string;
  evaluate(
    market: MarketListItemDto,
    ctx: WeatherEvaluationContext,
  ): Promise<WeatherEvaluationResult>;
}