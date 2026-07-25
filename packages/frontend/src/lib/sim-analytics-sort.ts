import type { TraderAnalyticsRow } from '../lib/trader-analytics';
import { traderDisplayName } from '../lib/trader-analytics';

export type SortKey =
  | 'trader'
  | 'positions'
  | 'realizedPnl'
  | 'unrealizedPnl'
  | 'totalPnl'
  | 'roiPercent'
  | 'winRatePercent'
  | 'profitFactor'
  | 'avgHoldDurationMs'
  | 'feesTotal';

export type SortDir = 'asc' | 'desc';

function compareNullableNumber(
  a: number | null,
  b: number | null,
  dir: SortDir,
): number {
  const av = a ?? Number.NEGATIVE_INFINITY;
  const bv = b ?? Number.NEGATIVE_INFINITY;
  return dir === 'asc' ? av - bv : bv - av;
}

export function compareTraders(
  a: TraderAnalyticsRow,
  b: TraderAnalyticsRow,
  key: SortKey,
  dir: SortDir,
): number {
  switch (key) {
    case 'trader':
      return dir === 'asc'
        ? traderDisplayName(a).localeCompare(traderDisplayName(b), 'fr')
        : traderDisplayName(b).localeCompare(traderDisplayName(a), 'fr');
    case 'positions':
      return dir === 'asc'
        ? a.positionCount - b.positionCount
        : b.positionCount - a.positionCount;
    case 'realizedPnl':
      return dir === 'asc'
        ? a.realizedPnl - b.realizedPnl
        : b.realizedPnl - a.realizedPnl;
    case 'unrealizedPnl':
      return dir === 'asc'
        ? a.unrealizedPnl - b.unrealizedPnl
        : b.unrealizedPnl - a.unrealizedPnl;
    case 'totalPnl':
      return dir === 'asc' ? a.totalPnl - b.totalPnl : b.totalPnl - a.totalPnl;
    case 'roiPercent':
      return compareNullableNumber(a.roiPercent, b.roiPercent, dir);
    case 'winRatePercent':
      return compareNullableNumber(a.winRatePercent, b.winRatePercent, dir);
    case 'profitFactor':
      return compareNullableNumber(a.profitFactor, b.profitFactor, dir);
    case 'avgHoldDurationMs':
      return compareNullableNumber(a.avgHoldDurationMs, b.avgHoldDurationMs, dir);
    case 'feesTotal':
      return dir === 'asc' ? a.feesTotal - b.feesTotal : b.feesTotal - a.feesTotal;
    default:
      return 0;
  }
}

export function sortIndicator(active: boolean, dir: SortDir): string {
  if (!active) return '';
  return dir === 'asc' ? ' ↑' : ' ↓';
}

export function sortButtonLabel(
  key: SortKey,
  label: string,
  activeKey: SortKey,
  dir: SortDir,
): string {
  return `${label}${sortIndicator(activeKey === key, dir)}`;
}

export function defaultSortDirForKey(key: SortKey): SortDir {
  return key === 'trader' ? 'asc' : 'desc';
}
