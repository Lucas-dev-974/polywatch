export type E2eRunStatus = 'running' | 'passed' | 'failed' | 'cancelled';
export type E2ePositionStatus = 'open' | 'closed';

export type {
  E2eRunSummary,
  E2eTestCaseSummary,
  E2eTestCaseLocation,
} from '@polywatch/core/entities/E2eTestRun';

import type { E2eRunSummary } from '@polywatch/core/entities/E2eTestRun';
import type { E2eTestCaseSummary } from '@polywatch/core/entities/E2eTestRun';

export interface E2eRunDto {
  id: string;
  suite: string;
  status: E2eRunStatus;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  exitCode: number | null;
  summary: E2eRunSummary | null;
  triggeredBy: string | null;
  errorMessage: string | null;
}

export interface E2eSuiteDto {
  id: string;
  label: string;
  description: string;
  requiresConfirmation: boolean;
}

export interface E2ePositionDto {
  id: string;
  runId: string;
  conditionId: string;
  marketQuestion: string | null;
  cryptoSymbol: string | null;
  interval: string | null;
  outcome: string;
  side: string;
  entryPrice: number;
  quantity: number;
  currentPrice: number | null;
  pnlPercent: number | null;
  realizedPnl: number | null;
  status: E2ePositionStatus;
  closeReason: string | null;
  openedAt: string;
  closedAt: string | null;
}

export interface E2ePositionUpdateEvent {
  runId: string;
  positionId: string;
  currentPrice: number;
  pnlPercent: number;
}

export interface E2eSuiteOverviewItem {
  suite: E2eSuiteDto;
  lastRun: E2eRunDto | null;
}

export interface E2eHistoryResponse {
  items: E2eRunDto[];
  total: number;
  limit: number;
  offset: number;
}

export function formatE2eDuration(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms)) return '—';
  if (ms < 1000) return `${ms} ms`;
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  return `${min}m ${rem}s`;
}

/** Durée affichée : live si en cours, fixe une fois terminé. */
export function computeE2eDisplayDurationMs(
  run: Pick<E2eRunDto, 'startedAt' | 'finishedAt' | 'durationMs' | 'status'>,
  nowMs: number,
): number {
  if (run.status !== 'running' && run.durationMs != null) {
    return run.durationMs;
  }
  return Math.max(0, nowMs - new Date(run.startedAt).getTime());
}

export function formatE2eRunDuration(
  run: Pick<E2eRunDto, 'startedAt' | 'finishedAt' | 'durationMs' | 'status'>,
  nowMs: number,
): string {
  return formatE2eDuration(computeE2eDisplayDurationMs(run, nowMs));
}

export function e2eStatusLabel(status: E2eRunStatus): string {
  switch (status) {
    case 'running':
      return 'En cours';
    case 'passed':
      return 'Réussi';
    case 'failed':
      return 'Échoué';
    case 'cancelled':
      return 'Annulé';
  }
}

export function e2eTestCaseStatusLabel(
  status: E2eTestCaseSummary['status'],
): string {
  switch (status) {
    case 'passed':
      return 'Réussi';
    case 'failed':
      return 'Échoué';
    case 'skipped':
      return 'Ignoré';
    case 'timedOut':
      return 'Timeout';
  }
}

export function e2eSummaryText(summary: E2eRunSummary | null): string {
  if (!summary) return '—';
  return `${summary.passed} ok / ${summary.failed} ko / ${summary.skipped} skip (${summary.total} total)`;
}

export function e2eSuiteLabel(suites: E2eSuiteDto[], id: string): string {
  return suites.find((s) => s.id === id)?.label ?? id;
}

export function parseE2eApiError(err: unknown): string {
  if (!(err instanceof Error)) return 'Échec du lancement';
  if (err.message === 'spawn_failed') return 'Impossible de lancer npm (spawn)';
  if (err.message === 'run_in_progress') return 'Un test est déjà en cours';
  return err.message;
}

export function formatShortDateTimeSafe(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export function formatPrice(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return value.toFixed(4);
}

export function formatPnlPercent(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

export function pnlColorClass(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '';
  if (value > 0) return 'pnl-positive';
  if (value < 0) return 'pnl-negative';
  return '';
}