import type { CryptoAlgoOptimizeReport } from './optimize-report.js';

export interface AnalysisReportParams {
  mode: 'sim';
  reason: 'ALGO_OPEN';
  closedFrom?: string | null;
  closedTo?: string | null;
}

export interface AnalysisReportSummary {
  id: number;
  createdAt: string;
  label: string;
  note: string | null;
  type: 'crypto_algo_optimize';
  params: AnalysisReportParams;
  configFingerprint: string;
  scopeSummary: string;
  positionsClosedCount: number;
  positionsTotalCount: number;
  realizedAlgo: number | null;
  verdictTitle: string | null;
}

export interface AnalysisReportDetail extends AnalysisReportSummary {
  payload: CryptoAlgoOptimizeReport;
}

export interface CompareReportMetricRow {
  id: string;
  label: string;
  valueA: string;
  valueB: string;
  delta: string;
  deltaClass: 'positive' | 'negative' | 'neutral';
}

export interface CompareAnalysisReportsResult {
  reportA: AnalysisReportSummary;
  reportB: AnalysisReportSummary;
  rows: CompareReportMetricRow[];
}

function pnlDeltaClass(delta: number): 'positive' | 'negative' | 'neutral' {
  if (delta > 0) return 'positive';
  if (delta < 0) return 'negative';
  return 'neutral';
}

function formatDelta(delta: number, suffix = ''): string {
  const sign = delta > 0 ? '+' : '';
  return `${sign}${Math.round(delta * 100) / 100}${suffix}`;
}

export function compareCryptoAlgoOptimizeReports(
  a: AnalysisReportDetail,
  b: AnalysisReportDetail,
): CompareAnalysisReportsResult {
  const pa = a.payload;
  const pb = b.payload;
  const rows: CompareReportMetricRow[] = [
    {
      id: 'realizedAlgo',
      label: 'PnL algo (fermées)',
      valueA: String(pa.totals.realizedAlgo),
      valueB: String(pb.totals.realizedAlgo),
      delta: formatDelta(pb.totals.realizedAlgo - pa.totals.realizedAlgo, ' $'),
      deltaClass: pnlDeltaClass(pb.totals.realizedAlgo - pa.totals.realizedAlgo),
    },
    {
      id: 'winRate',
      label: 'Win rate (fermées)',
      valueA: pa.totals.winRateClosed != null ? `${pa.totals.winRateClosed}%` : '—',
      valueB: pb.totals.winRateClosed != null ? `${pb.totals.winRateClosed}%` : '—',
      delta:
        pa.totals.winRateClosed != null && pb.totals.winRateClosed != null
          ? formatDelta(pb.totals.winRateClosed - pa.totals.winRateClosed, ' pts')
          : '—',
      deltaClass:
        pa.totals.winRateClosed != null && pb.totals.winRateClosed != null
          ? pnlDeltaClass(pb.totals.winRateClosed - pa.totals.winRateClosed)
          : 'neutral',
    },
    {
      id: 'cancelled',
      label: 'Cancelled',
      valueA: String(pa.totals.cancelled),
      valueB: String(pb.totals.cancelled),
      delta: formatDelta(pb.totals.cancelled - pa.totals.cancelled),
      deltaClass: pnlDeltaClass(-(pb.totals.cancelled - pa.totals.cancelled)),
    },
    {
      id: 'whipsaw',
      label: 'Whipsaw (SL · peak ≥ 30 %)',
      valueA: String(pa.whipsaw.count),
      valueB: String(pb.whipsaw.count),
      delta: formatDelta(pb.whipsaw.count - pa.whipsaw.count),
      deltaClass: pnlDeltaClass(-(pb.whipsaw.count - pa.whipsaw.count)),
    },
    {
      id: 'whipsawPnl',
      label: 'PnL whipsaw',
      valueA: String(pa.whipsaw.sumPnl),
      valueB: String(pb.whipsaw.sumPnl),
      delta: formatDelta(pb.whipsaw.sumPnl - pa.whipsaw.sumPnl, ' $'),
      deltaClass: pnlDeltaClass(pb.whipsaw.sumPnl - pa.whipsaw.sumPnl),
    },
    {
      id: 'configFingerprint',
      label: 'Config fingerprint',
      valueA: a.configFingerprint,
      valueB: b.configFingerprint,
      delta: a.configFingerprint === b.configFingerprint ? 'Identique' : 'Différent',
      deltaClass: a.configFingerprint === b.configFingerprint ? 'neutral' : 'negative',
    },
  ];

  const slA = pa.byCloseReason.find((r) => r.closeReason === 'SL');
  const slB = pb.byCloseReason.find((r) => r.closeReason === 'SL');
  if (slA || slB) {
    rows.push({
      id: 'slPnl',
      label: 'PnL SL',
      valueA: slA ? String(slA.sumPnl) : '—',
      valueB: slB ? String(slB.sumPnl) : '—',
      delta: slA && slB ? formatDelta(slB.sumPnl - slA.sumPnl, ' $') : '—',
      deltaClass:
        slA && slB ? pnlDeltaClass(slB.sumPnl - slA.sumPnl) : 'neutral',
    });
  }

  const redA = pa.byCloseReason.find((r) => r.closeReason === 'REDEMPTION');
  const redB = pb.byCloseReason.find((r) => r.closeReason === 'REDEMPTION');
  if (redA || redB) {
    rows.push({
      id: 'redPnl',
      label: 'PnL REDEMPTION',
      valueA: redA ? String(redA.sumPnl) : '—',
      valueB: redB ? String(redB.sumPnl) : '—',
      delta: redA && redB ? formatDelta(redB.sumPnl - redA.sumPnl, ' $') : '—',
      deltaClass:
        redA && redB ? pnlDeltaClass(redB.sumPnl - redA.sumPnl) : 'neutral',
    });
  }

  return {
    reportA: a,
    reportB: b,
    rows,
  };
}
