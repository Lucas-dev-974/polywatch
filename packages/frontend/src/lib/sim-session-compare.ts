import { formatShortDateTime } from './date';
import { formatPnlAmount, pnlClass } from './position';
import {
  formatCompareDelta,
  type CompareDeltaMode,
} from './sim-snapshot-compare';
import {
  formatSessionDuration,
  type SimSessionSummary,
} from './simulation-sessions';

export type SessionCompareRow = {
  id: string;
  label: string;
  format: (s: SimSessionSummary) => string;
  pnlField?: boolean;
  numeric?: (s: SimSessionSummary) => number;
};

function sessionPnl(s: SimSessionSummary): number {
  return s.sessionPnl ?? s.endingSessionPnl ?? 0;
}

function sessionEquity(s: SimSessionSummary): number {
  return s.endingEquity ?? s.peakEquity ?? s.baselineCapital;
}

export const SESSION_COMPARE_ROWS: ReadonlyArray<SessionCompareRow> = [
  {
    id: 'label',
    label: 'Label',
    format: (s) => s.label?.trim() || `Session #${s.id}`,
  },
  {
    id: 'status',
    label: 'Statut',
    format: (s) => (s.status === 'active' ? 'Active' : 'Fermée'),
  },
  {
    id: 'started',
    label: 'Début',
    format: (s) => formatShortDateTime(s.startedAt),
  },
  {
    id: 'ended',
    label: 'Fin',
    format: (s) =>
      s.endedAt ? formatShortDateTime(s.endedAt) : 'En cours',
  },
  {
    id: 'duration',
    label: 'Durée',
    format: (s) => formatSessionDuration(s.durationMs),
    numeric: (s) => s.durationMs ?? 0,
  },
  {
    id: 'baseline',
    label: 'Baseline',
    format: (s) => formatPnlAmount(s.baselineCapital),
    numeric: (s) => s.baselineCapital,
  },
  {
    id: 'equity',
    label: 'Equity finale',
    format: (s) => formatPnlAmount(sessionEquity(s)),
    numeric: (s) => sessionEquity(s),
  },
  {
    id: 'sessionPnl',
    label: 'PnL session',
    format: (s) => formatPnlAmount(sessionPnl(s), true),
    pnlField: true,
    numeric: (s) => sessionPnl(s),
  },
  {
    id: 'peak',
    label: 'Peak equity',
    format: (s) =>
      s.peakEquity != null ? formatPnlAmount(s.peakEquity) : '—',
    numeric: (s) => s.peakEquity ?? 0,
  },
  {
    id: 'trough',
    label: 'Trough equity',
    format: (s) =>
      s.troughEquity != null ? formatPnlAmount(s.troughEquity) : '—',
    numeric: (s) => s.troughEquity ?? 0,
  },
  {
    id: 'drawdown',
    label: 'Drawdown peak→trough',
    format: (s) => {
      if (s.peakEquity == null || s.troughEquity == null) return '—';
      return formatPnlAmount(s.troughEquity - s.peakEquity, true);
    },
    pnlField: true,
    numeric: (s) =>
      s.peakEquity != null && s.troughEquity != null
        ? s.troughEquity - s.peakEquity
        : 0,
  },
  {
    id: 'snapshots',
    label: 'Snapshots',
    format: (s) => String(s.snapshotCount),
    numeric: (s) => s.snapshotCount,
  },
  {
    id: 'pnlPerSnapshot',
    label: 'PnL / snapshot',
    format: (s) => {
      if (s.snapshotCount <= 0) return '—';
      return formatPnlAmount(sessionPnl(s) / s.snapshotCount, true);
    },
    pnlField: true,
    numeric: (s) =>
      s.snapshotCount > 0 ? sessionPnl(s) / s.snapshotCount : 0,
  },
];

export function sessionColumnLabel(s: SimSessionSummary): string {
  const name = s.label?.trim() || `#${s.id}`;
  const date = formatShortDateTime(s.startedAt);
  return `${name} · ${date}`;
}

export function sessionCompareRowHasDiff(
  row: SessionCompareRow,
  sessions: SimSessionSummary[],
): boolean {
  if (sessions.length < 2) return false;
  if (row.numeric) {
    const values = sessions.map((s) => row.numeric!(s));
    return new Set(values.map((v) => v.toFixed(4))).size > 1;
  }
  const values = sessions.map((s) => row.format(s));
  return new Set(values).size > 1;
}

export { formatCompareDelta, formatPnlAmount, pnlClass };
export type { CompareDeltaMode };
