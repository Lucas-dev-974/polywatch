export interface RealArchiveSummary {
  positions: number;
  executions: number;
  exitAttempts: number;
  periodFrom: string | null;
  periodTo: string | null;
}

export type RealArchiveType = 'positions' | 'executions' | 'exit_attempts';

export interface RealArchiveListOptions {
  limit?: number;
  offset?: number;
}

export interface RealArchiveListResult<T> {
  summary: RealArchiveSummary | null;
  items: T[];
  total: number;
}

export interface RealArchivePositionDto {
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

export interface RealArchiveExecutionDto {
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

export interface RealArchiveExitAttemptDto {
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
