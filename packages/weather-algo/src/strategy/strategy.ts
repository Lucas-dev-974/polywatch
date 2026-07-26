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
  city: string;
  metric: 'highest_temp' | 'lowest_temp';
  targetDate: Date;
  forecastMean: number;
  forecastStdDev: number;
  forecastProbability: number;
  marketPrice: number;
  edge: number;
  /** Bucket comparison type at entry time (city-follow). Null for manual/expand entries. */
  entryBucketComparison?: 'exact' | 'between' | 'or_below' | 'or_above' | null;
  /** Bucket bounds at entry time (city-follow). Null for manual/expand entries. */
  entryBucketBounds?: { low?: number | null; high?: number | null; target?: number | null } | null;
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