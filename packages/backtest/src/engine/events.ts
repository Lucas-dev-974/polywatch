/**
 * Event types consumed by the weather backtest adapter.
 */

export interface BookTickEventData {
  conditionId: string;
  /** YES price (0..1). */
  yesPrice: number | null;
  noPrice: number | null;
  volume: number | null;
  volume24hr: number | null;
  liquidityClob: number | null;
  acceptingOrders: boolean | null;
  closed: boolean | null;
  endDate: Date | null;
  bucketComparison: string | null;
  bucketTarget: number | null;
  bucketLow: number | null;
  bucketHigh: number | null;
  eventSlug: string | null;
  question: string | null;
  tokenIdYes: string | null;
  /** Parent snapshot context, used to reconstruct the market + forecast. */
  snapshotCity: string;
  snapshotTargetDateIso: string;
  snapshotMetric: string;
  snapshotForecastMean: number | null;
  /** Parent snapshot id (for fidelity aggregation / dedup). */
  snapshotId: number;
  /** Active buckets recorded in the parent snapshot. */
  snapshotBucketCount: number;
  /** Total buckets found (active + excluded) in the parent snapshot. */
  snapshotTotalBucketCount: number;
}

export interface ForecastRevisionData {
  city: string;
  /** Calendar target date (the day being forecast). */
  forecastDate: Date;
  metric: string;
  forecastMean: number;
  forecastStdDev: number;
  /** When this revision was fetched (as-of key for replay). */
  fetchedAt: Date;
}

export interface SignalEventData {
  conditionId: string;
  /** YES price recorded at evaluation time. */
  yesPrice: number | null;
  strategyId: string;
  decision: string;
  forecastProb: number | null;
  edge: number | null;
  dynamicMinEdge: number | null;
  bucketComparison: string | null;
  bucketTarget: number | null;
  bucketLow: number | null;
  bucketHigh: number | null;
  /** City resolved from the parent snapshot, if any. */
  city: string | null;
  /** Forecast mean from the parent snapshot (used to populate entryMean in replay). */
  snapshotForecastMean: number | null;
  /** Target date from the parent snapshot (fallback when no tick precedes the signal). */
  snapshotTargetDateIso: string | null;
  /** Metric from the parent snapshot. */
  snapshotMetric: string | null;
}

export type BacktestEvent =
  | { kind: 'book_tick'; at: Date; data: BookTickEventData }
  | { kind: 'forecast'; at: Date; data: ForecastRevisionData }
  | { kind: 'signal'; at: Date; data: SignalEventData };
