export interface SimArchiveSummary {
  positions: number;
  executions: number;
  exitAttempts: number;
  surveillance: number;
  candles: number;
  periodFrom: string | null;
  periodTo: string | null;
}

export type SimArchiveType =
  | 'positions'
  | 'executions'
  | 'exit_attempts'
  | 'surveillance'
  | 'candles';

export interface SimArchiveListOptions {
  limit?: number;
  offset?: number;
}

export interface SimArchiveListResult<T> {
  summary: SimArchiveSummary | null;
  items: T[];
  total: number;
}

export interface SimArchivePositionDto {
  id: number;
  sourceId: number;
  conditionId: string;
  assetId: string;
  marketTitle: string | null;
  outcome: string;
  side: string;
  size: number;
  entryPrice: number;
  exitPrice: number | null;
  realizedPnl: number;
  closeReason: string | null;
  reason: string | null;
  openedAt: string | null;
  closedAt: string | null;
}

export interface SimArchiveExecutionDto {
  id: number;
  sourceId: number;
  copiedPositionId: number;
  side: string;
  fillPrice: number | null;
  fillQuantity: number | null;
  fees: number;
  realizedPnl: number;
  status: string;
  reason: string | null;
  executedAt: string | null;
}

export interface SimArchiveExitAttemptDto {
  id: number;
  sourceId: number;
  copiedPositionId: number;
  kind: string;
  closeReason: string;
  blockReason: string | null;
  error: string | null;
  markBid: number | null;
  createdAt: string;
}

export interface SimArchiveSurveillanceDto {
  id: number;
  sourceId: number;
  conditionId: string;
  question: string | null;
  cryptoSymbol: string | null;
  interval: string | null;
  winningOutcome: string | null;
  positionsJson: string | null;
}

export interface SimArchiveCandleDto {
  id: number;
  source: string;
  conditionId: string;
  assetId: string | null;
  bucketStart: string;
  open: number;
  high: number;
  low: number;
  close: number;
  tickCount: number;
}
