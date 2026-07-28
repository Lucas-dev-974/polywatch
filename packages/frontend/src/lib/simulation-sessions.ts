import type { SimSessionSummary } from '@polywatch/core';
import { api } from '../api';

import type { SimAlgoKind } from './simulation';

export type SimSessionStatus = 'active' | 'closed';

export type SimSessionSummary = import('@polywatch/core').SimSessionSummary;

export interface SimulationSessionsListResponse {
  items: SimSessionSummary[];
  total: number;
}

export interface SimulationSessionListFilters {
  algoKind?: SimAlgoKind;
  status?: SimSessionStatus | 'all';
  label?: string;
  from?: string;
  to?: string;
}

function appendSessionFilters(
  params: URLSearchParams,
  filters?: SimulationSessionListFilters,
): void {
  if (!filters) return;
  if (filters.algoKind) params.set('algoKind', filters.algoKind);
  else params.set('algoKind', 'crypto');
  if (filters.status && filters.status !== 'all') {
    params.set('status', filters.status);
  }
  const label = filters.label?.trim();
  if (label) params.set('label', label);
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
}

export async function fetchSimulationSessions(
  limit = 50,
  offset = 0,
  filters?: SimulationSessionListFilters,
): Promise<SimulationSessionsListResponse> {
  const params = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
  });
  appendSessionFilters(params, filters);
  return api<SimulationSessionsListResponse>(
    `/simulation-sessions?${params.toString()}`,
  );
}

export async function fetchCurrentSimulationSession(
  algoKind: SimAlgoKind = 'crypto',
): Promise<SimSessionSummary | null> {
  return api<SimSessionSummary | null>(
    `/simulation-sessions/current?algoKind=${algoKind}`,
  );
}

export async function updateSimulationSession(
  id: number,
  patch: { label?: string | null; notes?: string | null },
): Promise<SimSessionSummary> {
  return api<SimSessionSummary>(`/simulation-sessions/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export async function deleteSimulationSession(
  id: number,
  algoKind: SimAlgoKind,
  deleteSnapshots = false,
): Promise<{ deleted: boolean; snapshotsDeleted: number }> {
  const params = new URLSearchParams({ algoKind });
  if (deleteSnapshots) params.set('deleteSnapshots', 'true');
  return api(`/simulation-sessions/${id}?${params.toString()}`, { method: 'DELETE' });
}

export interface SimulationClosedSessionsDeleteResult {
  sessionsDeleted: number;
  snapshotsDeleted: number;
}

export async function deleteAllClosedSimulationSessions(
  algoKind: SimAlgoKind,
): Promise<SimulationClosedSessionsDeleteResult> {
  return api<SimulationClosedSessionsDeleteResult>(
    `/simulation-sessions/closed?algoKind=${algoKind}`,
    { method: 'DELETE' },
  );
}

export function formatSessionDuration(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return '—';
  const totalMin = Math.floor(ms / 60_000);
  if (totalMin < 60) return `${totalMin} min`;
  const hours = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  if (hours < 48) return mins > 0 ? `${hours} h ${mins} min` : `${hours} h`;
  const days = Math.floor(hours / 24);
  const remH = hours % 24;
  return remH > 0 ? `${days} j ${remH} h` : `${days} j`;
}
