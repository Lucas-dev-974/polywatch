import { api } from '../api';

export type ExitAttemptKind = 'emit_blocked' | 'execution_failed';

export interface ExitAttemptEvent {
  id: number;
  copiedPositionId: number;
  kind: ExitAttemptKind;
  closeReason: string;
  blockReason: string | null;
  error: string | null;
  executionId: number | null;
  /** Bid mark used for the exit decision (0–1); null on legacy rows. */
  markBid?: number | null;
  createdAt: string;
}

export interface ExitAttemptsResponse {
  items: ExitAttemptEvent[];
  total: number;
}

export interface ExitAttemptSummary {
  total: number;
  emitBlocked: number;
  executionFailed: number;
  byCloseReason: Record<string, number>;
  last: ExitAttemptEvent | null;
}

const CLOSE_REASON_ORDER = [
  'SL',
  'TP',
  'TRAILING',
  'PRE_CLOSE_LOSS',
  'PRE_CLOSE_WIN',
  'KILL_SWITCH',
] as const;

export function normalizeMarkBid(
  value: number | null | undefined,
): number | null {
  if (value == null || !Number.isFinite(value) || value <= 0) return null;
  return value;
}

export function fetchExitAttempts(
  copiedPositionId: number,
): Promise<ExitAttemptsResponse> {
  return api<ExitAttemptsResponse>(
    `/copied-positions/${copiedPositionId}/exit-attempts`,
  );
}

export function summarizeExitAttempts(
  items: ExitAttemptEvent[],
): ExitAttemptSummary {
  const byCloseReason: Record<string, number> = {};
  let emitBlocked = 0;
  let executionFailed = 0;

  for (const item of items) {
    if (item.kind === 'emit_blocked') emitBlocked += 1;
    else if (item.kind === 'execution_failed') executionFailed += 1;
    byCloseReason[item.closeReason] =
      (byCloseReason[item.closeReason] ?? 0) + 1;
  }

  return {
    total: items.length,
    emitBlocked,
    executionFailed,
    byCloseReason,
    last: items.length > 0 ? items[items.length - 1]! : null,
  };
}

/** Non-zero close-reason counts, stable display order then extras alpha. */
export function exitAttemptBreakdownRows(
  byCloseReason: Record<string, number>,
): { reason: string; count: number }[] {
  const rows: { reason: string; count: number }[] = [];
  const seen = new Set<string>();

  for (const reason of CLOSE_REASON_ORDER) {
    const count = byCloseReason[reason] ?? 0;
    if (count > 0) {
      rows.push({ reason, count });
      seen.add(reason);
    }
  }

  for (const reason of Object.keys(byCloseReason).sort()) {
    if (seen.has(reason)) continue;
    const count = byCloseReason[reason] ?? 0;
    if (count > 0) rows.push({ reason, count });
  }

  return rows;
}

function formatMarkBidSuffix(markBid?: number | null): string {
  const normalized = normalizeMarkBid(markBid);
  return normalized != null ? ` @ ${(normalized * 100).toFixed(1)}¢` : '';
}

export function formatExitAttemptLabel(input: {
  closeReason: string;
  kind: ExitAttemptKind;
  blockReason: string | null;
  error: string | null;
  markBid?: number | null;
}): string {
  const detail =
    input.kind === 'emit_blocked'
      ? (input.blockReason ?? 'blocked')
      : (input.error ?? 'failed');
  return `${input.closeReason} / ${detail}${formatMarkBidSuffix(input.markBid)}`;
}

export function formatExitAttemptDetail(event: ExitAttemptEvent): string {
  return formatExitAttemptLabel(event);
}

export function formatSlAttemptMarkerLabel(
  marker: Pick<
    ExitAttemptEvent,
    'kind' | 'blockReason' | 'error' | 'markBid'
  >,
): string {
  return formatExitAttemptLabel({ ...marker, closeReason: 'SL' });
}
