import type { RealSessionSummary } from '@polywatch/core';
import type { RealArchiveSummary } from '@polywatch/core';
import { api } from '../api';

export type RealSessionStatus = 'active' | 'closed';

export type { RealSessionSummary };

export interface RealSessionsListResponse {
  items: RealSessionSummary[];
  total: number;
}

export interface RealSessionListFilters {
  status?: RealSessionStatus | 'all';
  label?: string;
  from?: string;
  to?: string;
}

export interface RealPeriodRotateResult {
  archiveSummary: RealArchiveSummary | null;
  endingEquity: number;
  endingSessionPnl: number;
}

function appendSessionFilters(
  params: URLSearchParams,
  filters?: RealSessionListFilters,
): void {
  if (!filters) return;
  if (filters.status && filters.status !== 'all') {
    params.set('status', filters.status);
  }
  const label = filters.label?.trim();
  if (label) params.set('label', label);
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
}

export async function fetchRealSessions(
  limit = 50,
  offset = 0,
  filters?: RealSessionListFilters,
): Promise<RealSessionsListResponse> {
  const params = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
  });
  appendSessionFilters(params, filters);
  return api<RealSessionsListResponse>(`/real-sessions?${params.toString()}`);
}

export async function fetchCurrentRealSession(): Promise<RealSessionSummary | null> {
  return api<RealSessionSummary | null>('/real-sessions/current');
}

export async function updateRealSession(
  id: number,
  patch: { label?: string | null; notes?: string | null },
): Promise<RealSessionSummary> {
  return api<RealSessionSummary>(`/real-sessions/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export async function deleteRealSession(
  id: number,
  deleteSnapshots = false,
): Promise<{ deleted: boolean; snapshotsDeleted: number }> {
  const q = deleteSnapshots ? '?deleteSnapshots=true' : '';
  return api(`/real-sessions/${id}${q}`, { method: 'DELETE' });
}

export interface RealClosedSessionsDeleteResult {
  sessionsDeleted: number;
  snapshotsDeleted: number;
}

export async function deleteAllClosedRealSessions(): Promise<RealClosedSessionsDeleteResult> {
  return api<RealClosedSessionsDeleteResult>('/real-sessions/closed', {
    method: 'DELETE',
  });
}

export async function rotateRealPeriod(opts: {
  archive?: boolean;
  clearClosedLive?: boolean;
  newPeriodLabel?: string | null;
}): Promise<RealPeriodRotateResult> {
  return api<RealPeriodRotateResult>('/real-sessions/rotate', {
    method: 'POST',
    body: JSON.stringify({
      archive: opts.archive ?? true,
      clearClosedLive: opts.clearClosedLive ?? false,
      newPeriodLabel: opts.newPeriodLabel ?? null,
    }),
  });
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
