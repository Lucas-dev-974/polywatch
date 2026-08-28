import type { MarketListItemDto, TradingMode } from '@polywatch/core';
import type { WeatherStrategyParamsBag } from '@polywatch/core';
import type { WeatherMetric } from '@polywatch/core';

export interface WeatherSignal {
  conditionId: string;
  assetId: string;
  outcome: 'YES' | 'NO';
  side: 'BUY';
  confidence: number;
  reasons: string[];
  strategyId: string;
  /** Trading environment that produced this signal ('sim' | 'real'). */
  mode: TradingMode;
  eventSlug: string;
  city: string;
  metric: WeatherMetric;
  targetDate: Date;
  forecastMean: number;
  forecastStdDev: number;
  forecastProbability: number;
  marketPrice: number;
  edge: number;
  dynamicMinEdge: number;
  /** Bucket comparison type at entry time (city-follow). Null for manual/expand entries. */
  entryBucketComparison?: 'exact' | 'between' | 'or_below' | 'or_above' | null;
  /** Bucket bounds at entry time (city-follow). Null for manual/expand entries. */
  entryBucketBounds?: { low?: number | null; high?: number | null; target?: number | null } | null;
  /** Original unit of the market question (celsius | fahrenheit). Null for non-weather or legacy. */
  unit?: 'celsius' | 'fahrenheit' | null;
}

export interface WeatherEvaluationContext {
  forecastMean: number;
  forecastStdDev: number;
  /** Trading environment the current evaluation pass belongs to ('sim' | 'real'). */
  mode: TradingMode;
}

export type WeatherEvaluationResult =
  | { kind: 'signal'; signal: WeatherSignal }
  | {
      kind: 'abstain';
      reason: string;
      detail?: string;
      forecastProb?: number;
      edge?: number;
      dynamicMinEdge?: number;
    };

export interface WeatherStrategy {
  readonly id: string;
  evaluate(
    market: MarketListItemDto,
    ctx: WeatherEvaluationContext,
    now?: Date,
  ): Promise<WeatherEvaluationResult>;
  /**
   * Optional group evaluation: receives all active buckets for a city/date.
   * When implemented, the runner calls this instead of per-bucket evaluate loops.
   */
  evaluateGroup?(
    markets: MarketListItemDto[],
    ctx: WeatherEvaluationContext,
    now?: Date,
  ): Promise<WeatherEvaluationResult>;
  /** Push the per-strategy resolved params into the strategy. Optional; default no-op. */
  setRiskConfig?(risk: WeatherStrategyParamsBag): void;
}
