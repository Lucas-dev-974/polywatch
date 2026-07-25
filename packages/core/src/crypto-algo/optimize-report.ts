import { isOpenLikePositionStatus } from '../positions/mark.js';
import {
  buildRecommendedCryptoAlgoConfig,
  type OptimizeReportRecommendedConfig,
} from './optimize-report-recommendations.js';

/** Minimum closed positions before emitting optimization levers. */
export const OPTIMIZE_REPORT_MIN_CLOSED = 20;

export interface OptimizeReportPositionInput {
  id: number;
  status: string;
  closeReason: string | null;
  realizedPnl: number;
  entryPrice: number;
  entryBidVwap: number;
  peakClosurePnlPercent: number | null;
  openedAt: Date | null;
  closedAt: Date | null;
  marketSlug: string | null;
}

export interface OptimizeReportConfigInput {
  cryptoAlgoEnabled: boolean;
  cryptoAlgoStrategies: string | null;
  cryptoAlgoSlEnabled: boolean;
  cryptoAlgoTpEnabled: boolean;
  cryptoAlgoTrailingEnabled: boolean;
  cryptoAlgoSlBidPoints: number | null;
  cryptoAlgoTpBidPoints: number | null;
  cryptoAlgoTrailingBidPoints: number | null;
  cryptoAlgoTrailingActivationBidPoints: number | null;
  cryptoAlgoPreCloseEnabled: boolean;
  cryptoAlgoPreCloseSeconds: number | null;
  cryptoAlgoPreCloseKeepEnabled: boolean | null;
  cryptoAlgoPreCloseKeepBidThreshold: number | null;
  slConfirmationTicks: number | null;
  cryptoAlgoBaseThreshold: number | null;
  cryptoAlgoSizingMode: string;
  cryptoAlgoEntryUsdcAmount: number;
  cryptoAlgoEntryShareCount: number | null;
  simEntryUsdcAmount: number;
  simEntryShareCount: number;
  simSizingMode: string;
}

export interface OptimizeReportBalanceInput {
  cash: number;
  baseline: number;
}

export interface OptimizeReportExitAttemptRow {
  kind: string;
  closeReason: string;
  blockReason: string | null;
  error: string | null;
  count: number;
}

export interface OptimizeReportTickCoverageInput {
  closedWithTicks: number;
  closedTotal: number;
  avgTicksWhenPresent: number | null;
}

export interface OptimizeReportCloseReasonRow {
  closeReason: string;
  count: number;
  sumPnl: number;
  avgPnl: number;
  wins: number;
  losses: number;
  avgPeakPct: number | null;
  avgDurationSec: number | null;
}

export interface OptimizeReportPeakBucketRow {
  bucket: string;
  count: number;
  sumPnl: number;
  avgPnl: number;
}

export interface OptimizeReportEntryBucketRow {
  bucket: string;
  count: number;
  sumPnl: number;
  avgPnl: number;
  wins: number;
  slPct: number;
  redemptionWinPct: number;
}

export interface OptimizeReportAssetRow {
  asset: string;
  closed: number;
  sumPnl: number;
  slCount: number;
  redemptionWins: number;
  redemptionLosses: number;
}

export interface OptimizeReportLever {
  priority: 'P0' | 'P1' | 'P2';
  title: string;
  detail: string;
}

export interface CryptoAlgoOptimizeReport {
  generatedAt: string;
  balance: {
    cash: number;
    baseline: number;
    note: 'sim_global';
  };
  config: OptimizeReportConfigInput & { isLiveConfig: true };
  totals: {
    all: number;
    closed: number;
    cancelled: number;
    openLike: number;
    realizedAlgo: number;
    winRateClosed: number | null;
    cancelledPct: number | null;
  };
  byCloseReason: OptimizeReportCloseReasonRow[];
  slPeakBuckets: OptimizeReportPeakBucketRow[];
  whipsaw: { count: number; sumPnl: number; avgPeakPct: number | null };
  trailingOpportunity: { count: number; sumPnl: number; avgPeakPct: number | null };
  entryBuckets: OptimizeReportEntryBucketRow[];
  byAsset: OptimizeReportAssetRow[];
  exitAttempts: OptimizeReportExitAttemptRow[];
  tickCoverage: OptimizeReportTickCoverageInput;
  verdict: {
    tone: 'success' | 'warning' | 'danger' | 'neutral';
    title: string;
    detail: string;
  };
  levers: OptimizeReportLever[];
  recommendedConfig: OptimizeReportRecommendedConfig;
}

export interface BuildCryptoAlgoOptimizeReportInput {
  positions: OptimizeReportPositionInput[];
  config: OptimizeReportConfigInput;
  balance: OptimizeReportBalanceInput;
  exitAttempts: OptimizeReportExitAttemptRow[];
  tickCoverage: OptimizeReportTickCoverageInput;
  generatedAt?: Date;
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function avg(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function durationSec(openedAt: Date | null, closedAt: Date | null): number | null {
  if (!openedAt || !closedAt) return null;
  return (closedAt.getTime() - openedAt.getTime()) / 1000;
}

function slPeakBucket(peak: number | null): string {
  if (peak == null || !Number.isFinite(peak)) return 'null';
  if (peak < 0) return 'peak_<0';
  if (peak < 10) return 'peak_0-10';
  if (peak < 30) return 'peak_10-30';
  if (peak < 50) return 'peak_30-50';
  return 'peak_>=50';
}

function entryBucket(entryPrice: number): string {
  if (entryPrice < 0.55) return 'a_<0.55';
  if (entryPrice < 0.6) return 'b_0.55-0.60';
  if (entryPrice < 0.65) return 'c_0.60-0.65';
  if (entryPrice < 0.7) return 'd_0.65-0.70';
  return 'e_>=0.70';
}

function assetFromSlug(slug: string | null): string {
  const s = (slug ?? '').toLowerCase();
  if (s.startsWith('btc')) return 'btc';
  if (s.startsWith('eth')) return 'eth';
  if (s.startsWith('sol')) return 'sol';
  if (s.startsWith('xrp')) return 'xrp';
  return 'other';
}

function buildByCloseReason(closed: OptimizeReportPositionInput[]): OptimizeReportCloseReasonRow[] {
  const map = new Map<string, OptimizeReportPositionInput[]>();
  for (const p of closed) {
    const key = p.closeReason ?? 'unknown';
    const list = map.get(key) ?? [];
    list.push(p);
    map.set(key, list);
  }
  return [...map.entries()]
    .map(([closeReason, rows]) => {
      const peaks = rows
        .map((r) => r.peakClosurePnlPercent)
        .filter((v): v is number => v != null && Number.isFinite(v));
      const durations = rows
        .map((r) => durationSec(r.openedAt, r.closedAt))
        .filter((v): v is number => v != null);
      const sumPnl = rows.reduce((s, r) => s + r.realizedPnl, 0);
      const wins = rows.filter((r) => r.realizedPnl > 0).length;
      return {
        closeReason,
        count: rows.length,
        sumPnl: round4(sumPnl),
        avgPnl: round4(sumPnl / rows.length),
        wins,
        losses: rows.length - wins,
        avgPeakPct: peaks.length ? round2(avg(peaks)!) : null,
        avgDurationSec: durations.length ? round2(avg(durations)!) : null,
      };
    })
    .sort((a, b) => a.sumPnl - b.sumPnl);
}

function buildSlPeakBuckets(closedSl: OptimizeReportPositionInput[]): OptimizeReportPeakBucketRow[] {
  const order = ['peak_<0', 'peak_0-10', 'peak_10-30', 'peak_30-50', 'peak_>=50', 'null'];
  const map = new Map<string, OptimizeReportPositionInput[]>();
  for (const p of closedSl) {
    const key = slPeakBucket(p.peakClosurePnlPercent);
    const list = map.get(key) ?? [];
    list.push(p);
    map.set(key, list);
  }
  return order
    .filter((b) => map.has(b))
    .map((bucket) => {
      const rows = map.get(bucket)!;
      const sumPnl = rows.reduce((s, r) => s + r.realizedPnl, 0);
      return {
        bucket,
        count: rows.length,
        sumPnl: round4(sumPnl),
        avgPnl: round4(sumPnl / rows.length),
      };
    });
}

function buildEntryBuckets(closed: OptimizeReportPositionInput[]): OptimizeReportEntryBucketRow[] {
  const order = ['a_<0.55', 'b_0.55-0.60', 'c_0.60-0.65', 'd_0.65-0.70', 'e_>=0.70'];
  const withEntry = closed.filter((p) => p.entryPrice > 0);
  const map = new Map<string, OptimizeReportPositionInput[]>();
  for (const p of withEntry) {
    const key = entryBucket(p.entryPrice);
    const list = map.get(key) ?? [];
    list.push(p);
    map.set(key, list);
  }
  return order
    .filter((b) => map.has(b))
    .map((bucket) => {
      const rows = map.get(bucket)!;
      const sumPnl = rows.reduce((s, r) => s + r.realizedPnl, 0);
      const wins = rows.filter((r) => r.realizedPnl > 0).length;
      const slCount = rows.filter((r) => r.closeReason === 'SL').length;
      const redWins = rows.filter(
        (r) => r.closeReason === 'REDEMPTION' && r.realizedPnl > 0,
      ).length;
      return {
        bucket,
        count: rows.length,
        sumPnl: round4(sumPnl),
        avgPnl: round4(sumPnl / rows.length),
        wins,
        slPct: round2((slCount / rows.length) * 100),
        redemptionWinPct: round2((redWins / rows.length) * 100),
      };
    });
}

function buildByAsset(closed: OptimizeReportPositionInput[]): OptimizeReportAssetRow[] {
  const map = new Map<string, OptimizeReportPositionInput[]>();
  for (const p of closed) {
    const key = assetFromSlug(p.marketSlug);
    const list = map.get(key) ?? [];
    list.push(p);
    map.set(key, list);
  }
  return [...map.entries()]
    .map(([asset, rows]) => ({
      asset,
      closed: rows.length,
      sumPnl: round4(rows.reduce((s, r) => s + r.realizedPnl, 0)),
      slCount: rows.filter((r) => r.closeReason === 'SL').length,
      redemptionWins: rows.filter(
        (r) => r.closeReason === 'REDEMPTION' && r.realizedPnl > 0,
      ).length,
      redemptionLosses: rows.filter(
        (r) => r.closeReason === 'REDEMPTION' && r.realizedPnl <= 0,
      ).length,
    }))
    .sort((a, b) => a.sumPnl - b.sumPnl);
}

function slSubset(
  closed: OptimizeReportPositionInput[],
  minPeak: number,
): { count: number; sumPnl: number; avgPeakPct: number | null } {
  const rows = closed.filter(
    (p) =>
      p.closeReason === 'SL' &&
      p.peakClosurePnlPercent != null &&
      p.peakClosurePnlPercent >= minPeak,
  );
  const peaks = rows
    .map((r) => r.peakClosurePnlPercent!)
    .filter((v) => Number.isFinite(v));
  const sumPnl = rows.reduce((s, r) => s + r.realizedPnl, 0);
  return {
    count: rows.length,
    sumPnl: round4(sumPnl),
    avgPeakPct: peaks.length ? round2(avg(peaks)!) : null,
  };
}

function buildVerdictAndLevers(
  closed: OptimizeReportPositionInput[],
  byCloseReason: OptimizeReportCloseReasonRow[],
  whipsaw: { count: number; sumPnl: number },
  trailingOpportunity: { count: number; sumPnl: number },
  entryBuckets: OptimizeReportEntryBucketRow[],
  byAsset: OptimizeReportAssetRow[],
  exitAttempts: OptimizeReportExitAttemptRow[],
  realizedAlgo: number,
): { verdict: CryptoAlgoOptimizeReport['verdict']; levers: OptimizeReportLever[] } {
  const closedCount = closed.length;
  if (closedCount < OPTIMIZE_REPORT_MIN_CLOSED) {
    return {
      verdict: {
        tone: 'neutral',
        title: 'Données insuffisantes',
        detail: `${closedCount} position(s) fermée(s) — au moins ${OPTIMIZE_REPORT_MIN_CLOSED} requises pour des leviers fiables.`,
      },
      levers: [],
    };
  }

  const slRow = byCloseReason.find((r) => r.closeReason === 'SL');
  const redRow = byCloseReason.find((r) => r.closeReason === 'REDEMPTION');
  const slPnl = slRow?.sumPnl ?? 0;
  const redPnl = redRow?.sumPnl ?? 0;
  const levers: OptimizeReportLever[] = [];

  if (slRow && redRow && slPnl < 0 && redPnl > 0 && Math.abs(slPnl) > redPnl * 0.5) {
    levers.push({
      priority: 'P0',
      title: 'Assouplir ou conditionner le SL',
      detail: `SL ${slRow.count} trades · ${round4(slPnl)} $ vs REDEMPTION +${round4(redPnl)} $. Tester SL plus large, pre-close losers, ou SL seulement si peak jamais > X %.`,
    });
  }

  const exitTotal = exitAttempts.reduce((s, r) => s + r.count, 0);
  if (exitTotal >= 100) {
    levers.push({
      priority: 'P1',
      title: 'Fiabiliser l’exécution des sorties SL',
      detail: `${exitTotal} tentatives bloquées/échouées. Corriger below_min_order_size, no_liquidity et retries exhausted.`,
    });
  }

  if (whipsaw.count >= 10 && whipsaw.sumPnl < 0) {
    levers.push({
      priority: 'P1',
      title: 'Activer un trailing stop',
      detail: `${whipsaw.count} SL avec peak ≥ 30 % (PnL observé ${round4(whipsaw.sumPnl)} $). Trailing après activation pour verrouiller les run-ups.`,
    });
  } else if (trailingOpportunity.count >= 20 && trailingOpportunity.sumPnl < 0) {
    levers.push({
      priority: 'P1',
      title: 'Activer un trailing stop',
      detail: `${trailingOpportunity.count} SL avec peak ≥ 20 % (PnL observé ${round4(trailingOpportunity.sumPnl)} $).`,
    });
  }

  const midEntry = entryBuckets.filter((b) =>
    ['b_0.55-0.60', 'c_0.60-0.65'].includes(b.bucket),
  );
  const midPnl = midEntry.reduce((s, b) => s + b.sumPnl, 0);
  const midCount = midEntry.reduce((s, b) => s + b.count, 0);
  if (midCount >= 30 && midPnl < -50) {
    levers.push({
      priority: 'P2',
      title: 'Filtrer les entrées 0.55–0.65',
      detail: `${midCount} trades · PnL observé ${round4(midPnl)} $. Renforcer le gate momentum ou éviter cette zone de prix.`,
    });
  }

  const worstAsset = byAsset.find((a) => a.closed >= 20 && a.sumPnl < -30);
  if (worstAsset) {
    levers.push({
      priority: 'P2',
      title: `Revoir l’asset ${worstAsset.asset.toUpperCase()}`,
      detail: `${worstAsset.closed} closed · PnL ${round4(worstAsset.sumPnl)} $ · ${worstAsset.slCount} SL.`,
    });
  }

  const redLosses = byAsset.reduce((s, a) => s + a.redemptionLosses, 0);
  if (redLosses >= 5) {
    levers.push({
      priority: 'P1',
      title: 'Pre-close sur losers avant résolution',
      detail: `${redLosses} REDEMPTION perdantes observées. Activer pre-close ~40–60 s si bid < entry.`,
    });
  }

  let tone: CryptoAlgoOptimizeReport['verdict']['tone'] = 'neutral';
  let title = 'Performance mixte';
  let detail = `PnL algo observé ${round4(realizedAlgo)} $ sur ${closedCount} fermées.`;

  if (realizedAlgo > 50) {
    tone = 'success';
    title = 'Edge positif';
    detail = `PnL algo +${round4(realizedAlgo)} $. ${redRow ? `REDEMPTION +${round4(redPnl)} $.` : ''}`;
  } else if (realizedAlgo < -50 && slPnl < 0 && Math.abs(slPnl) > (redPnl > 0 ? redPnl : 0)) {
    tone = 'danger';
    title = 'SL détruit le edge';
    detail = `PnL algo ${round4(realizedAlgo)} $. SL ${round4(slPnl)} $ vs REDEMPTION +${round4(redPnl)} $.`;
  } else if (realizedAlgo < 0) {
    tone = 'warning';
    title = 'PnL algo négatif';
    detail = `PnL observé ${round4(realizedAlgo)} $ — voir leviers ci-dessous.`;
  }

  return { verdict: { tone, title, detail }, levers };
}

export function buildCryptoAlgoOptimizeReport(
  input: BuildCryptoAlgoOptimizeReportInput,
): CryptoAlgoOptimizeReport {
  const { positions, config, balance, exitAttempts, tickCoverage } = input;
  const closed = positions.filter((p) => p.status === 'closed');
  const cancelled = positions.filter((p) => p.status === 'cancelled');
  const openLike = positions.filter((p) => isOpenLikePositionStatus(p.status));
  const closedSl = closed.filter((p) => p.closeReason === 'SL');
  const realizedAlgo = round4(closed.reduce((s, p) => s + p.realizedPnl, 0));
  const winningClosed = closed.filter((p) => p.realizedPnl > 0).length;
  const winRateClosed =
    closed.length > 0 ? round2((winningClosed / closed.length) * 100) : null;
  const cancelledPct =
    positions.length > 0 ? round2((cancelled.length / positions.length) * 100) : null;

  const byCloseReason = buildByCloseReason(closed);
  const whipsaw = slSubset(closed, 30);
  const trailingOpportunity = slSubset(closed, 20);
  const entryBuckets = buildEntryBuckets(closed);
  const byAsset = buildByAsset(closed);
  const { verdict, levers } = buildVerdictAndLevers(
    closed,
    byCloseReason,
    whipsaw,
    trailingOpportunity,
    entryBuckets,
    byAsset,
    exitAttempts,
    realizedAlgo,
  );

  const draft: CryptoAlgoOptimizeReport = {
    generatedAt: (input.generatedAt ?? new Date()).toISOString(),
    balance: {
      cash: round4(balance.cash),
      baseline: round4(balance.baseline),
      note: 'sim_global',
    },
    config: { ...config, isLiveConfig: true },
    totals: {
      all: positions.length,
      closed: closed.length,
      cancelled: cancelled.length,
      openLike: openLike.length,
      realizedAlgo,
      winRateClosed,
      cancelledPct,
    },
    byCloseReason,
    slPeakBuckets: buildSlPeakBuckets(closedSl),
    whipsaw,
    trailingOpportunity,
    entryBuckets,
    byAsset,
    exitAttempts: exitAttempts.slice(0, 15),
    tickCoverage,
    verdict,
    levers,
    recommendedConfig: { applicable: false, changes: [], patch: {} },
  };

  return {
    ...draft,
    recommendedConfig: buildRecommendedCryptoAlgoConfig(draft),
  };
}
