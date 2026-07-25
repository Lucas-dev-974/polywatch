import { formatShortDateTime } from './date';
import { formatPnlAmount, pnlClass } from './position';
import type {
  SimSnapshotTrader,
  SimStateSnapshotDetail,
  SimStateSnapshotSource,
  SimStateSnapshotSummary,
} from './simulation-snapshots';

export type CompareDeltaMode = 'absolute' | 'percent';

/** Snapshot config may still carry pre-split `simSlTpEnabled` from archived JSON. */
export type SnapshotExitConfig = {
  simSlEnabled?: boolean;
  simTpEnabled?: boolean;
  /** @deprecated Pre-split coupled toggle; used only for legacy snapshot display. */
  simSlTpEnabled?: boolean;
};

/** Resolve SL enable for compare UI, including legacy coupled flag. */
export function isSnapshotSimSlEnabled(config: SnapshotExitConfig): boolean {
  if (config.simSlEnabled != null) return config.simSlEnabled;
  return config.simSlTpEnabled === true;
}

/** Resolve TP enable for compare UI, including legacy coupled flag. */
export function isSnapshotSimTpEnabled(config: SnapshotExitConfig): boolean {
  if (config.simTpEnabled != null) return config.simTpEnabled;
  return config.simSlTpEnabled === true;
}

export type CompareRow = {
  id: string;
  label: string;
  format: (s: SimStateSnapshotSummary, d?: SimStateSnapshotDetail) => string;
  pnlField?: keyof Pick<
    SimStateSnapshotSummary,
    'sessionPnl' | 'openPnlSum' | 'closedPnlSum'
  >;
  numeric?: (s: SimStateSnapshotSummary) => number;
};

export const SNAPSHOT_SOURCE: Record<
  SimStateSnapshotSource,
  { badgeClass: string; badgeLabel: string; compareLabel: string }
> = {
  manual: { badgeClass: 'neutral', badgeLabel: 'Manuel', compareLabel: 'Manuel' },
  auto: { badgeClass: 'sim', badgeLabel: 'Auto', compareLabel: 'Automatique' },
  reset: { badgeClass: 'warn', badgeLabel: 'Reset', compareLabel: 'Réinitialisation' },
};

export const COMPARE_ROWS: ReadonlyArray<CompareRow> = [
  { id: 'date', label: 'Date', format: (s) => formatShortDateTime(s.createdAt) },
  { id: 'label', label: 'Label', format: (s) => s.label ?? '—' },
  {
    id: 'source',
    label: 'Source',
    format: (s) => SNAPSHOT_SOURCE[s.source].compareLabel,
  },
  {
    id: 'traders',
    label: 'Traders',
    format: (s) => `${s.traderCount} · ${s.tradersLabel || '—'}`,
    numeric: (s) => s.traderCount,
  },
  {
    id: 'equity',
    label: 'Equity',
    format: (s) => `${formatPnlAmount(s.equity)} ${s.token}`,
    numeric: (s) => s.equity,
  },
  {
    id: 'cash',
    label: 'Cash',
    format: (s) => `${formatPnlAmount(s.amount)} ${s.token}`,
    numeric: (s) => s.amount,
  },
  {
    id: 'positionsValue',
    label: 'Valeur positions',
    format: (s) => `${formatPnlAmount(s.positionsValue)} ${s.token}`,
    numeric: (s) => s.positionsValue,
  },
  {
    id: 'sessionPnl',
    label: 'PnL session',
    format: (s) => `${formatPnlAmount(s.sessionPnl, true)} ${s.token}`,
    pnlField: 'sessionPnl',
    numeric: (s) => s.sessionPnl,
  },
  {
    id: 'openPnl',
    label: 'PnL ouvert',
    format: (s) => `${formatPnlAmount(s.openPnlSum, true)} ${s.token}`,
    pnlField: 'openPnlSum',
    numeric: (s) => s.openPnlSum,
  },
  {
    id: 'closedPnl',
    label: 'PnL fermé',
    format: (s) => `${formatPnlAmount(s.closedPnlSum, true)} ${s.token}`,
    pnlField: 'closedPnlSum',
    numeric: (s) => s.closedPnlSum,
  },
  {
    id: 'positions',
    label: 'Positions',
    format: (s) =>
      `${s.positionCount} (${s.openPositionCount} ouv. / ${s.closedPositionCount} ferm.)`,
    numeric: (s) => s.positionCount,
  },
  {
    id: 'executions',
    label: 'Exécutions',
    format: (s) => String(s.executionCount),
    numeric: (s) => s.executionCount,
  },
  {
    id: 'trailing',
    label: 'Trailing',
    format: (_s, d) => (d?.config.simTrailingEnabled ? 'on' : 'off'),
  },
  {
    id: 'sizing',
    label: 'Sizing',
    format: (_s, d) => d?.config.simSizingMode ?? '—',
  },
  {
    id: 'copyRatio',
    label: 'Copy ratio',
    format: (_s, d) => (d != null ? String(d.config.simCopyRatio) : '—'),
  },
];

export function snapshotColumnLabel(s: SimStateSnapshotSummary): string {
  const date = formatShortDateTime(s.createdAt);
  return s.label ? `${date} · ${s.label}` : date;
}

export function formatCompareDelta(
  delta: number,
  mode: CompareDeltaMode,
  baseline: number,
): string {
  if (mode === 'percent') {
    const base = Math.abs(baseline) > 1e-9 ? baseline : 1;
    const pct = (delta / base) * 100;
    const prefix = pct > 0 ? '+' : '';
    return `${prefix}${pct.toFixed(1)}%`;
  }
  return formatPnlAmount(delta, true);
}

export function compareRowHasDiff(
  row: CompareRow,
  summaries: SimStateSnapshotSummary[],
  details: Map<number, SimStateSnapshotDetail>,
): boolean {
  if (summaries.length < 2) return false;
  if (row.numeric) {
    const values = summaries.map((s) => row.numeric!(s));
    return new Set(values.map((v) => v.toFixed(4))).size > 1;
  }
  const values = summaries.map((s) => row.format(s, details.get(s.id)));
  return new Set(values).size > 1;
}

export interface TraderCompareRow {
  traderAddress: string;
  label: string;
  realizedRef: number;
  realizedOther: number;
  unrealizedRef: number;
  unrealizedOther: number;
  deltaRealized: number;
  deltaUnrealized: number;
}

function traderLabel(t: SimSnapshotTrader): string {
  return t.nickname ?? `${t.traderAddress.slice(0, 10)}…`;
}

export function buildTraderComparison(
  reference: SimStateSnapshotDetail,
  other: SimStateSnapshotDetail,
): TraderCompareRow[] {
  const refMap = new Map(reference.traders.map((t) => [t.traderAddress.toLowerCase(), t]));
  const otherMap = new Map(other.traders.map((t) => [t.traderAddress.toLowerCase(), t]));
  const addresses = new Set([...refMap.keys(), ...otherMap.keys()]);

  return [...addresses]
    .map((addr) => {
      const ref = refMap.get(addr);
      const oth = otherMap.get(addr);
      const realizedRef = ref?.realizedPnl ?? 0;
      const realizedOther = oth?.realizedPnl ?? 0;
      const unrealizedRef = ref?.unrealizedPnl ?? 0;
      const unrealizedOther = oth?.unrealizedPnl ?? 0;
      return {
        traderAddress: addr,
        label: traderLabel(ref ?? oth!),
        realizedRef,
        realizedOther,
        unrealizedRef,
        unrealizedOther,
        deltaRealized: realizedOther - realizedRef,
        deltaUnrealized: unrealizedOther - unrealizedRef,
      };
    })
    .sort((a, b) => {
      const absA = Math.abs(a.deltaRealized) + Math.abs(a.deltaUnrealized);
      const absB = Math.abs(b.deltaRealized) + Math.abs(b.deltaUnrealized);
      return absB - absA;
    });
}

export { pnlClass, formatPnlAmount };
