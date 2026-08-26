import { api } from '../api';
import type { SimAlgoKind } from './simulation';
import type { SimRiskConfigSnapshot } from '@polywatch/core/risk/sim-mode-fields';

export type SimStateSnapshotSource = 'manual' | 'reset' | 'auto' | 'config_change';

export interface SimSnapshotTrader {
  watchlistId: number | null;
  traderAddress: string;
  nickname: string | null;
  active: boolean | null;
  simEnabled: boolean | null;
  inWatchlistSim: boolean;
  positionCount: number;
  openPositionCount: number;
  closedPositionCount: number;
  realizedPnl: number;
  unrealizedPnl: number;
}

export interface SimStateSnapshotSummary {
  id: number;
  createdAt: string;
  label: string | null;
  source: SimStateSnapshotSource;
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

export interface SimSnapshotPosition {
  id: number;
  watchlistId: number;
  conditionId: string;
  status: string;
  marketQuestion: string | null;
  traderName: string | null;
  traderAddress: string | null;
  unrealizedPnl: number;
  realizedPnl: number;
  slPercent?: number | null;
  tpPercent?: number | null;
  lastExitBlockReason?: string | null;
  closeReason?: string | null;
}

export interface SimSnapshotExecution {
  id?: number;
  side: string;
  reason: string | null;
  fillQuantity: number | null;
  fillPrice?: number | null;
  realizedPnl: number;
  executedAt: string | null;
  status?: string;
}

export interface SimSnapshotExitAttempt {
  id: number;
  copiedPositionId: number;
  kind: 'emit_blocked' | 'execution_failed';
  closeReason: string;
  blockReason: string | null;
  error: string | null;
  markBid: number | null;
  createdAt: string;
}

export interface SimSnapshotMoveEvent {
  id: string;
  traderAddress: string;
  conditionId: string;
  eventType: string;
  detectedAt: string;
  skipReasonsSim: string | null;
  processed: boolean;
}

export interface SimSnapshotDecisionSummary {
  exitAttemptsTotal: number;
  moveEventsTotal: number;
  moveEventsSkippedSim: number;
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

export interface SimStateSnapshotDetail extends SimStateSnapshotSummary {
  config: SimRiskConfigSnapshot;
  traders: SimSnapshotTrader[];
  positions: SimSnapshotPosition[];
  executions: SimSnapshotExecution[];
  exitAttempts: SimSnapshotExitAttempt[];
  moveEvents: SimSnapshotMoveEvent[];
  decisionSummary: SimSnapshotDecisionSummary | null;
}

export interface SimulationSnapshotsListResponse {
  items: SimStateSnapshotSummary[];
  total: number;
}

export type SimulationSnapshotSourceFilter = SimStateSnapshotSource | 'all';

export interface SimulationSnapshotListFilters {
  algoKind?: SimAlgoKind;
  source?: SimulationSnapshotSourceFilter;
  sessionId?: number;
  label?: string;
  from?: string;
  to?: string;
}

function appendListFilters(
  params: URLSearchParams,
  filters?: SimulationSnapshotListFilters,
): void {
  if (!filters) return;
  if (filters.algoKind) {
    params.set('algoKind', filters.algoKind);
  }
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

export async function fetchSimulationSnapshots(
  limit = 50,
  offset = 0,
  filters?: SimulationSnapshotListFilters,
): Promise<SimulationSnapshotsListResponse> {
  const params = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
  });
  appendListFilters(params, filters);
  return api<SimulationSnapshotsListResponse>(
    `/simulation-snapshots?${params.toString()}`,
  );
}

export async function createSimulationSnapshot(
  algoKind: SimAlgoKind,
  label?: string,
): Promise<SimStateSnapshotSummary> {
  return api<SimStateSnapshotSummary>('/simulation-snapshots', {
    method: 'POST',
    body: JSON.stringify({ algoKind, ...(label ? { label } : {}) }),
  });
}

export async function fetchSimulationSnapshotDetail(
  id: number,
): Promise<SimStateSnapshotDetail> {
  return api<SimStateSnapshotDetail>(`/simulation-snapshots/${id}`);
}

export async function deleteAllSimulationSnapshots(
  algoKind: SimAlgoKind,
): Promise<{ deleted: number }> {
  return api<{ deleted: number }>(`/simulation-snapshots?algoKind=${algoKind}`, {
    method: 'DELETE',
  });
}
