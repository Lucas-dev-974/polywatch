import { formatShortDateTime } from './date';
import type { AlgoEvent as CoreAlgoEvent, AlgoEventStatus } from '@polywatch/core/types';

export type { AlgoEventStatus };
export type AlgoEvent = CoreAlgoEvent;

export interface AlgoEventsResponse {
  items: AlgoEvent[];
  total: number;
}

export const ALGO_EVENT_STATUS_LABELS: Record<string, string> = {
  live: 'En cours',
  awaiting_close: 'En attente close',
  resolved: 'Résolu',
  unresolved: 'Non résolu',
};

export function algoEventBadgeClass(status: string): string {
  if (status === 'live') return 'sim';
  if (status === 'awaiting_close') return 'warn';
  if (status === 'resolved') return 'success';
  return 'danger';
}

export function algoEventStatusLabel(status: string): string {
  return ALGO_EVENT_STATUS_LABELS[status] ?? status;
}

export function formatAlgoEventTime(iso: string | null): string {
  if (!iso) return '—';
  return formatShortDateTime(iso);
}

export function algoEventMarketLabel(event: { question: string; conditionId: string }): string {
  return event.question || `${event.conditionId.slice(0, 12)}…`;
}
