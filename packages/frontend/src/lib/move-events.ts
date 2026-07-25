import { closeExecutionErrorLabel } from './execution';
import { formatShortDateTime } from './date';

export type MoveEventType = 'OPENED' | 'INCREASED' | 'DECREASED' | 'CLOSED';
export type ModeFilter = 'all' | 'sim' | 'real';

export interface MoveEvent {
  id: string;
  traderAddress: string;
  traderName: string;
  conditionId: string;
  assetId: string;
  eventType: MoveEventType;
  previousTraderSize: number;
  traderSize: number;
  traderAvgPrice: number | null;
  outcome: string | null;
  snapshotSeq: number;
  processed: boolean;
  detectedAt: string;
  marketTitle: string | null;
  marketUrl: string | null;
  executedSim: boolean;
  executedReal: boolean;
  copySlippage: number | null;
  skipReasonsSim: string | null;
  skipReasonsReal: string | null;
  executionErrorSim: string | null;
  executionErrorReal: string | null;
}

export const MOVE_EVENTS_PAGE_SIZE = 20;

export const MOVE_EVENT_FILTER_OPTIONS: { value: ModeFilter; label: string }[] = [
  { value: 'all', label: 'Tous' },
  { value: 'sim', label: 'Sim' },
  { value: 'real', label: 'Live' },
];

export const MOVE_EVENT_LABELS: Record<MoveEventType, string> = {
  OPENED: 'Ouverture',
  INCREASED: 'Augmentation',
  DECREASED: 'Réduction',
  CLOSED: 'Fermeture',
};

export function moveEventBadgeClass(type: MoveEventType): string {
  if (type === 'OPENED' || type === 'INCREASED') return 'success';
  if (type === 'CLOSED' || type === 'DECREASED') return 'warn';
  return 'neutral';
}

export function formatMoveEventTime(iso: string): string {
  return formatShortDateTime(iso);
}

export function formatSizeDelta(event: MoveEvent): string {
  const delta = event.traderSize - event.previousTraderSize;
  const sign = delta > 0 ? '+' : '';
  return `${event.previousTraderSize.toFixed(2)} → ${event.traderSize.toFixed(2)} (${sign}${delta.toFixed(2)})`;
}

export function formatTraderBet(event: MoveEvent): string {
  const parts: string[] = [formatSizeDelta(event)];
  if (event.traderAvgPrice && event.traderAvgPrice > 0) {
    parts.push(`@ ${event.traderAvgPrice.toFixed(3)}`);
  }
  if (event.outcome) {
    parts.push(`· ${event.outcome}`);
  }
  return parts.join(' ');
}

export function formatCopySlippage(slippage: number | null): string {
  if (slippage == null) return '—';
  const sign = slippage > 0 ? '+' : '';
  return `${sign}${slippage.toFixed(4)}`;
}

export function copySlippageClass(slippage: number | null): string {
  if (slippage == null) return 'neutral';
  if (slippage > 0) return 'danger';
  if (slippage < 0) return 'success';
  return 'neutral';
}

export function moveEventMarketLabel(event: MoveEvent): string {
  return event.marketTitle ?? `${event.conditionId.slice(0, 12)}…`;
}

export function moveEventStatusBadge(
  event: MoveEvent,
): { className: string; label: string; title?: string } {
  if (!event.processed) {
    return { className: 'sim', label: 'En attente' };
  }

  const liveError =
    event.skipReasonsReal ??
    closeExecutionErrorLabel(event.executionErrorReal) ??
    null;
  const simError =
    event.skipReasonsSim ??
    closeExecutionErrorLabel(event.executionErrorSim) ??
    null;

  if (liveError || simError) {
    const parts = [
      liveError ? `Live : ${liveError}` : null,
      simError ? `Sim : ${simError}` : null,
    ].filter(Boolean);
    return {
      className: 'danger',
      label: 'Ignoré',
      title: parts.join(' · '),
    };
  }

  if (event.executedReal || event.executedSim) {
    return { className: 'success', label: 'Copié' };
  }

  return { className: 'neutral', label: 'Traité' };
}

export interface MoveEventsResponse {
  items: MoveEvent[];
  total: number;
}
