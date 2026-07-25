import { classifyCloseReason } from '@polywatch/core/simulation/trader-analytics';
import type { AlgoSurveillancePositionSummary } from './algo-surveillance';
import { closeExecutionErrorLabel } from './execution';
import { closeReasonBadgeClass } from './position';

const OPEN_LIKE_STATUSES = new Set([
  'open',
  'closing',
  'pending_resolution',
  'failed',
]);

const STATUS_LABELS: Record<string, string> = {
  open: 'Ouverte',
  closed: 'Clôturée',
  closing: 'Clôture…',
  pending_resolution: 'Résolution',
  failed: 'Échec',
  pending: 'En attente',
  cancelled: 'Annulée',
};

/**
 * closeReason on a CopiedPosition can mean two different things:
 *  - an entry cancellation reason when the position never filled (reservation_expired, ...)
 *  - the final exit reason once the position is closed (TP, SL, COPY_CLOSE, ...)
 * Surveillance summaries currently carry the raw closeReason, so we must only treat
 * entry-cancellation codes as failures. Exit reasons are normal close outcomes and
 * should not be rendered as "Non exécutée".
 */
const ENTRY_CANCEL_REASONS = new Set([
  'reservation_expired',
  'reservation_released',
]);

const ENTRY_CANCEL_REASON_LABELS: Record<string, string> = {
  reservation_expired: 'réservation expirée (ordre non traité à temps)',
  reservation_released: 'réservation libérée (échec pipeline)',
};

const SKIP_REASON_LABELS: Record<string, string> = {
  pending_execution: 'en attente d\'exécution (file worker)',
};

/**
 * Human-readable reason why an algo surveillance position did not result in a filled trade.
 * Returns null for normally closed positions (TP/SL/...) and for still-pending positions
 * that have no error nor cancellation.
 */
export function surveillancePositionFailureHint(
  pos: AlgoSurveillancePositionSummary,
): string | null {
  const modeError =
    pos.mode === 'real' ? pos.executionErrorReal : pos.executionErrorSim;
  const execLabel = closeExecutionErrorLabel(modeError);
  if (execLabel) {
    return `Exécution échouée : ${execLabel}`;
  }

  if (pos.closeReason && ENTRY_CANCEL_REASONS.has(pos.closeReason)) {
    const closeLabel = ENTRY_CANCEL_REASON_LABELS[pos.closeReason] ?? pos.closeReason;
    return `Non exécutée : ${closeLabel}`;
  }

  if (pos.skipReason) {
    const skipLabel = SKIP_REASON_LABELS[pos.skipReason] ?? pos.skipReason;
    return `Non exécutée : ${skipLabel}`;
  }

  return null;
}

export function normalizeSurveillancePositions(
  positions?: AlgoSurveillancePositionSummary[] | null,
): AlgoSurveillancePositionSummary[] {
  return positions ?? [];
}

export function surveillancePositionPnl(pos: AlgoSurveillancePositionSummary): number {
  return OPEN_LIKE_STATUSES.has(pos.status) ? pos.unrealizedPnl : pos.realizedPnl;
}

export function surveillancePositionStatusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

/**
 * Use the core classifier to decide whether a closeReason is a normal exit.
 * Entry-cancellation pseudo-reasons (reservation_expired, ...) classify as 'other'
 * and are surfaced via the failure hint instead of the exit badge.
 */
function isSurveillanceExitReason(closeReason: string): boolean {
  return classifyCloseReason(closeReason) !== 'other';
}

const SURVEILLANCE_EXIT_REASON_SHORT_LABELS: Record<string, string> = {
  SL: 'SL',
  TP: 'TP',
  TRAILING: 'Trailing',
  PRE_CLOSE_LOSS: 'Pré-clôture',
  PRE_CLOSE_WIN: 'Pré-clôture',
  COPY_CLOSE: 'Copy',
  COPY_DECREASE: 'Copy',
  MANUAL: 'Manuel',
  KILL_SWITCH: 'Kill',
  REDEMPTION: 'Rédemption',
};

/** Human-readable short label for the exit reason of a closed surveillance position. */
export function surveillancePositionCloseReasonLabel(
  pos: AlgoSurveillancePositionSummary,
): string | null {
  if (pos.status !== 'closed' || !pos.closeReason) return null;
  if (!isSurveillanceExitReason(pos.closeReason)) return null;
  return SURVEILLANCE_EXIT_REASON_SHORT_LABELS[pos.closeReason] ?? pos.closeReason;
}

/** Badge class matching the exit reason semantics (danger for SL, success for TP, …). */
export function surveillancePositionCloseReasonBadgeClass(
  pos: AlgoSurveillancePositionSummary,
): string | null {
  if (pos.status !== 'closed' || !pos.closeReason) return null;
  if (!isSurveillanceExitReason(pos.closeReason)) return null;
  return closeReasonBadgeClass(pos.closeReason);
}

/** Share quantity at entry — closed positions zero {@link AlgoSurveillancePositionSummary.quantity}. */
export function surveillancePositionDisplayQuantity(
  pos: AlgoSurveillancePositionSummary,
): number | null {
  if (pos.quantity > 0) return pos.quantity;
  if (pos.entryQuantityFilled != null && pos.entryQuantityFilled > 0) {
    return pos.entryQuantityFilled;
  }
  return null;
}

export function surveillanceOutcomeClass(outcome: string): string {
  const normalized = outcome.trim().toLowerCase();
  if (normalized === 'up' || normalized === 'yes') return 'up';
  if (normalized === 'down' || normalized === 'no') return 'down';
  return 'neutral';
}

function formatEntryOffsetMs(deltaMs: number): string {
  const sign = deltaMs < 0 ? '-' : '+';
  const absSec = Math.round(Math.abs(deltaMs) / 1000);
  if (absSec < 60) return `t${sign}${absSec}s`;
  const minutes = Math.floor(absSec / 60);
  const seconds = absSec % 60;
  return seconds > 0 ? `t${sign}${minutes}m ${seconds}s` : `t${sign}${minutes}m`;
}

/** Offset of position entry vs market window start (t+0 = marketStartAt). */
export function formatSurveillancePositionEntryOffset(
  openedAt: string | null | undefined,
  marketStartAt: string | null | undefined,
): string | null {
  if (!openedAt || !marketStartAt) return null;
  const openMs = Date.parse(openedAt);
  const startMs = Date.parse(marketStartAt);
  if (!Number.isFinite(openMs) || !Number.isFinite(startMs)) return null;
  return formatEntryOffsetMs(openMs - startMs);
}
