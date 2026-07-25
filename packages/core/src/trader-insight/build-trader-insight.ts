import {
  ANALYTICS_PNL_CATEGORY_LABELS,
  ANALYTICS_PNL_CATEGORY_SLUGS,
  type AnalyticsPnlCategorySlug,
} from '../simulation/pnl-by-category.js';
import { resolveMarketNavCategorySlug } from '../market/nav-category.js';
import type {
  TraderInsightActivitySummary,
  TraderInsightMarketBreakdownRow,
  TraderInsightRecentActivity,
  TraderInsightTimelinePoint,
  TraderRegularityLabel,
} from '../types/trader-insight.js';

export const TRADER_INSIGHT_ACTIVITY_PAGE_SIZE = 500;
/** Polymarket Data API rejects offset > 3000 on `/activity`. */
export const TRADER_INSIGHT_MAX_ACTIVITY_OFFSET = 3000;
export const TRADER_INSIGHT_MAX_ACTIVITY_PAGES = Math.floor(
  TRADER_INSIGHT_MAX_ACTIVITY_OFFSET / TRADER_INSIGHT_ACTIVITY_PAGE_SIZE,
) + 1;

const MS_PER_DAY = 86_400_000;
const MS_PER_WEEK = 7 * MS_PER_DAY;

export interface TraderInsightActivityInput {
  timestamp: number;
  conditionId: string;
  type: string;
  usdcSize: number;
  size?: number;
  title?: string;
  slug?: string;
  side?: string;
  outcome?: string;
  transactionHash?: string;
  price?: number;
}

export interface TraderInsightMarketMeta {
  conditionId: string;
  tagSlugs?: string[] | null;
  category?: string | null;
  question?: string | null;
}

export function resolveRegularityLabel(
  score: number,
): TraderRegularityLabel {
  if (score >= 75) return 'very_regular';
  if (score >= 40) return 'moderate';
  return 'sporadic';
}

export function regularityLabelFr(label: TraderRegularityLabel): string {
  switch (label) {
    case 'very_regular':
      return 'Très régulier';
    case 'moderate':
      return 'Modéré';
    case 'sporadic':
      return 'Sporadique';
  }
}

function weekStartKey(timestampMs: number): string {
  const date = new Date(timestampMs);
  const day = date.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setUTCDate(date.getUTCDate() + diff);
  date.setUTCHours(0, 0, 0, 0);
  return date.toISOString().slice(0, 10);
}

function weekStartMs(key: string): number {
  return Date.parse(`${key}T00:00:00.000Z`);
}

function enumerateWeekKeys(firstMs: number, lastMs: number): string[] {
  const keys: string[] = [];
  let cursor = weekStartMs(weekStartKey(firstMs));
  const end = weekStartMs(weekStartKey(lastMs));
  while (cursor <= end) {
    keys.push(new Date(cursor).toISOString().slice(0, 10));
    cursor += MS_PER_WEEK;
  }
  return keys.length > 0 ? keys : [weekStartKey(firstMs)];
}

function computeLongestGapDays(timestampsMs: number[]): number {
  if (timestampsMs.length < 2) return 0;
  const sorted = [...timestampsMs].sort((a, b) => a - b);
  let maxGap = 0;
  for (let i = 1; i < sorted.length; i++) {
    const gapDays = (sorted[i]! - sorted[i - 1]!) / MS_PER_DAY;
    if (gapDays > maxGap) maxGap = gapDays;
  }
  return Math.round(maxGap);
}

function categoryForActivity(
  activity: TraderInsightActivityInput,
  marketMeta: Map<string, TraderInsightMarketMeta>,
): AnalyticsPnlCategorySlug {
  const meta = marketMeta.get(activity.conditionId.toLowerCase());
  return (
    resolveMarketNavCategorySlug(
      meta?.tagSlugs,
      meta?.category,
      meta?.question ?? activity.title ?? null,
    ) ?? 'other'
  );
}

export function buildActivitySummary(
  trades: TraderInsightActivityInput[],
): TraderInsightActivitySummary {
  if (trades.length === 0) {
    return {
      totalTrades: 0,
      totalVolumeUsdc: 0,
      firstActivityAt: null,
      lastActivityAt: null,
      tradingSpanDays: 0,
      activeWeeks: 0,
      totalWeeks: 0,
      avgTradesPerWeek: 0,
      avgTradesPerActiveWeek: 0,
      longestGapDays: 0,
      regularityScore: 0,
      regularityLabel: 'sporadic',
    };
  }

  const timestampsMs = trades.map((t) => t.timestamp * 1000);
  const firstMs = Math.min(...timestampsMs);
  const lastMs = Math.max(...timestampsMs);
  const totalVolumeUsdc = trades.reduce(
    (sum, t) => sum + (Number.isFinite(t.usdcSize) ? t.usdcSize : 0),
    0,
  );

  const weekCounts = new Map<string, number>();
  for (const trade of trades) {
    const key = weekStartKey(trade.timestamp * 1000);
    weekCounts.set(key, (weekCounts.get(key) ?? 0) + 1);
  }

  const allWeekKeys = enumerateWeekKeys(firstMs, lastMs);
  const activeWeeks = allWeekKeys.filter((key) => (weekCounts.get(key) ?? 0) > 0)
    .length;
  const totalWeeks = allWeekKeys.length;
  const regularityScore =
    totalWeeks > 0 ? Math.round((activeWeeks / totalWeeks) * 100) : 0;

  return {
    totalTrades: trades.length,
    totalVolumeUsdc,
    firstActivityAt: Math.floor(firstMs / 1000),
    lastActivityAt: Math.floor(lastMs / 1000),
    tradingSpanDays: Math.max(
      1,
      Math.ceil((lastMs - firstMs) / MS_PER_DAY) + 1,
    ),
    activeWeeks,
    totalWeeks,
    avgTradesPerWeek:
      totalWeeks > 0
        ? Math.round((trades.length / totalWeeks) * 10) / 10
        : 0,
    avgTradesPerActiveWeek:
      activeWeeks > 0
        ? Math.round((trades.length / activeWeeks) * 10) / 10
        : 0,
    longestGapDays: computeLongestGapDays(timestampsMs),
    regularityScore,
    regularityLabel: resolveRegularityLabel(regularityScore),
  };
}

export function buildActivityTimeline(
  trades: TraderInsightActivityInput[],
): TraderInsightTimelinePoint[] {
  const buckets = new Map<string, { tradeCount: number; volumeUsdc: number }>();
  for (const trade of trades) {
    const key = weekStartKey(trade.timestamp * 1000);
    const bucket = buckets.get(key) ?? { tradeCount: 0, volumeUsdc: 0 };
    bucket.tradeCount += 1;
    bucket.volumeUsdc += Number.isFinite(trade.usdcSize) ? trade.usdcSize : 0;
    buckets.set(key, bucket);
  }

  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([weekStart, bucket]) => ({
      weekStart,
      tradeCount: bucket.tradeCount,
      volumeUsdc: bucket.volumeUsdc,
    }));
}

export function buildMarketBreakdown(
  trades: TraderInsightActivityInput[],
  marketMeta: Map<string, TraderInsightMarketMeta>,
): TraderInsightMarketBreakdownRow[] {
  const totals = new Map<
    AnalyticsPnlCategorySlug,
    { tradeCount: number; volumeUsdc: number; markets: Set<string> }
  >(
    ANALYTICS_PNL_CATEGORY_SLUGS.map((slug) => [
      slug,
      { tradeCount: 0, volumeUsdc: 0, markets: new Set<string>() },
    ]),
  );

  for (const trade of trades) {
    const slug = categoryForActivity(trade, marketMeta);
    const bucket = totals.get(slug)!;
    bucket.tradeCount += 1;
    bucket.volumeUsdc += Number.isFinite(trade.usdcSize) ? trade.usdcSize : 0;
    bucket.markets.add(trade.conditionId.toLowerCase());
  }

  return ANALYTICS_PNL_CATEGORY_SLUGS.map((slug) => {
    const bucket = totals.get(slug)!;
    return {
      slug,
      label: ANALYTICS_PNL_CATEGORY_LABELS[slug],
      tradeCount: bucket.tradeCount,
      volumeUsdc: bucket.volumeUsdc,
      uniqueMarkets: bucket.markets.size,
    };
  }).filter((row) => row.tradeCount > 0);
}

const POLYGONSCAN_TX = 'https://polygonscan.com/tx/';

export function buildRecentActivity(
  trades: TraderInsightActivityInput[],
  limit = 50,
): TraderInsightRecentActivity[] {
  return [...trades]
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, limit)
    .map((trade) => {
      const txHash = trade.transactionHash?.trim() || null;
      const side =
        trade.side === 'BUY' || trade.side === 'SELL' ? trade.side : null;
      const market = trade.title?.trim() || trade.slug || 'Marché inconnu';
      const outcome = trade.outcome?.trim();
      const action = side === 'SELL' ? 'Vente' : side === 'BUY' ? 'Achat' : 'Trade';
      const title = outcome
        ? `${action} — ${market} (${outcome})`
        : `${action} — ${market}`;

      return {
        id: `polymarket:${txHash ?? 'no-tx'}:${trade.type}:${trade.timestamp}:${trade.conditionId}`,
        timestamp: trade.timestamp * 1000,
        title,
        side,
        amount: Number.isFinite(trade.usdcSize) ? trade.usdcSize : null,
        price:
          Number.isFinite(trade.price) && (trade.price ?? 0) > 0
            ? trade.price!
            : null,
        txHash,
        explorerUrl: txHash ? `${POLYGONSCAN_TX}${txHash}` : null,
      };
    });
}

export function filterTradeActivities(
  activities: TraderInsightActivityInput[],
): TraderInsightActivityInput[] {
  return activities.filter(
    (a) => a.type.toUpperCase() === 'TRADE' && a.timestamp > 0,
  );
}
