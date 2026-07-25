import type { MarketAnalyticsRow } from '../lib/market-analytics';
import { marketDisplayLabel } from '../lib/market-analytics';

export type MarketSortKey =
  | 'market'
  | 'category'
  | 'traderCount'
  | 'positions'
  | 'realizedPnl'
  | 'unrealizedPnl'
  | 'totalPnl'
  | 'roiPercent'
  | 'winRatePercent'
  | 'profitFactor'
  | 'avgHoldDurationMs'
  | 'feesTotal';

export type MarketSortDir = 'asc' | 'desc';

function compareNullableNumber(
  a: number | null,
  b: number | null,
  dir: MarketSortDir,
): number {
  const av = a ?? Number.NEGATIVE_INFINITY;
  const bv = b ?? Number.NEGATIVE_INFINITY;
  return dir === 'asc' ? av - bv : bv - av;
}

export function compareMarkets(
  a: MarketAnalyticsRow,
  b: MarketAnalyticsRow,
  key: MarketSortKey,
  dir: MarketSortDir,
): number {
  switch (key) {
    case 'market':
      return dir === 'asc'
        ? marketDisplayLabel(a).localeCompare(marketDisplayLabel(b), 'fr')
        : marketDisplayLabel(b).localeCompare(marketDisplayLabel(a), 'fr');
    case 'category':
      return dir === 'asc'
        ? (a.category ?? '').localeCompare(b.category ?? '', 'fr')
        : (b.category ?? '').localeCompare(a.category ?? '', 'fr');
    case 'traderCount':
      return dir === 'asc'
        ? a.traderCount - b.traderCount
        : b.traderCount - a.traderCount;
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

export function sortIndicator(active: boolean, dir: MarketSortDir): string {
  if (!active) return '';
  return dir === 'asc' ? ' ↑' : ' ↓';
}

export function sortButtonLabel(
  key: MarketSortKey,
  label: string,
  activeKey: MarketSortKey,
  dir: MarketSortDir,
): string {
  return `${label}${sortIndicator(activeKey === key, dir)}`;
}

export function defaultSortDirForKey(key: MarketSortKey): MarketSortDir {
  return key === 'market' || key === 'category' ? 'asc' : 'desc';
}
