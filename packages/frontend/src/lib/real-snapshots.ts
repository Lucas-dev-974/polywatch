import { api } from '../api';
import type { RealRiskConfigSnapshot } from '@polywatch/core/risk/sim-mode-fields';

export type RealStateSnapshotSource = 'manual' | 'auto' | 'rotate' | 'config_change';

export interface RealSnapshotTrader {
  watchlistId: number | null;
  traderAddress: string;
  nickname: string | null;
  active: boolean | null;
  realEnabled: boolean | null;
  inWatchlistReal: boolean;
  positionCount: number;
  openPositionCount: number;
  closedPositionCount: number;
  realizedPnl: number;
  unrealizedPnl: number;
}

export interface RealStateSnapshotSummary {
  id: number;
  createdAt: string;
  label: string | null;
  source: RealStateSnapshotSource;
  sessionId?: number | null;
  sessionLabel?: string | null;
  amount: number;
  token: string;
  positionsValue: number;
  equity: number;
  openPnlSum: number;
  closedPnlSum: number;
  baselineCapital: number;
  positionCount: number;
  openPositionCount: number;
  closedPositionCount: number;
  executionCount: number;
  traderCount: number;
  tradersLabel: string;
  sessionPnl: number;
}

export interface RealSnapshotPosition {
  id: number;
  watchlistId: number;
  conditionId: string;
  status: string;
  marketQuestion: string | null;
  traderName: string | null;
  traderAddress: string | null;
  unrealizedPnl: number;
  realizedPnl: number;
  slBidPoints?: number | null;
  tpBidPoints?: number | null;
  lastExitBlockReason?: string | null;
  closeReason?: string | null;
}

export interface RealSnapshotExecution {
  id?: number;
  side: string;
  reason: string | null;
  fillQuantity: number | null;
  fillPrice?: number | null;
  realizedPnl: number;
  executedAt: string | null;
  status?: string;
}

export interface RealSnapshotExitAttempt {
  id: number;
  copiedPositionId: number;
  kind: 'emit_blocked' | 'execution_failed';
  closeReason: string;
  blockReason: string | null;
  error: string | null;
  markBid: number | null;
  createdAt: string;
}

export interface RealSnapshotMoveEvent {
  id: string;
  traderAddress: string;
  conditionId: string;
  eventType: string;
  detectedAt: string;
  skipReasonsReal: string | null;
  processed: boolean;
}

export interface RealSnapshotDecisionSummary {
  exitAttemptsTotal: number;
  moveEventsTotal: number;
  moveEventsSkippedReal: number;
  windowFrom: string;
  snapshotAt: string;
  truncated: boolean;
  openPositionCount: number;
  closedPositionCount: number;
  otherPositionCount: number;
  positionsByStatus: Record<string, number>;
  exitAttemptsByKind: Record<string, number>;
  exitAttemptsByCloseReason: Record<string, number>;
  moveEventsByType: Record<string, number>;
}

export interface RealStateSnapshotDetail extends RealStateSnapshotSummary {
  config: RealRiskConfigSnapshot;
  traders: RealSnapshotTrader[];
  positions: RealSnapshotPosition[];
  executions: RealSnapshotExecution[];
  exitAttempts: RealSnapshotExitAttempt[];
  moveEvents: RealSnapshotMoveEvent[];
  decisionSummary: RealSnapshotDecisionSummary | null;
}

export interface RealSnapshotsListResponse {
  items: RealStateSnapshotSummary[];
  total: number;
}

export type RealSnapshotSourceFilter = RealStateSnapshotSource | 'all';

export interface RealSnapshotListFilters {
  source?: RealSnapshotSourceFilter;
  sessionId?: number;
  label?: string;
  from?: string;
  to?: string;
}

function appendListFilters(
  params: URLSearchParams,
  filters?: RealSnapshotListFilters,
): void {
  if (!filters) return;
  if (filters.source && filters.source !== 'all') {
    params.set('source', filters.source);
  }
  if (filters.sessionId != null) {
    params.set('sessionId', String(filters.sessionId));
  }
  const label = filters.label?.trim();
  if (label) params.set('label', label);
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
}

export async function fetchRealSnapshots(
  limit = 50,
  offset = 0,
  filters?: RealSnapshotListFilters,
): Promise<RealSnapshotsListResponse> {
  const params = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
  });
  appendListFilters(params, filters);
  return api<RealSnapshotsListResponse>(`/real-snapshots?${params.toString()}`);
}

export async function createRealSnapshot(
  label?: string,
): Promise<RealStateSnapshotSummary> {
  return api<RealStateSnapshotSummary>('/real-snapshots', {
    method: 'POST',
    body: JSON.stringify(label ? { label } : {}),
  });
}

export async function fetchRealSnapshotDetail(
  id: number,
): Promise<RealStateSnapshotDetail> {
  return api<RealStateSnapshotDetail>(`/real-snapshots/${id}`);
}

export async function deleteAllRealSnapshots(): Promise<{ deleted: number }> {
  return api<{ deleted: number }>('/real-snapshots', {
    method: 'DELETE',
  });
}
