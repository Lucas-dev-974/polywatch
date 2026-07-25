import { NAV_MARKET_TAG_SLUGS } from '../market/tags.js';
import { isOpenLikePositionStatus } from '../positions/mark.js';
import type { EnrichedCopiedPosition } from '../services/copied-position-presenter.js';
import {
  MARKET_NAV_CATEGORY_LABELS,
  resolveMarketNavCategorySlug,
  type MarketNavCategorySlug,
} from '../market/nav-category.js';

/** Nav categories shown on the analytics bar chart, plus uncategorized. */
export const ANALYTICS_PNL_CATEGORY_SLUGS = [
  ...NAV_MARKET_TAG_SLUGS,
  'other',
] as const;

export type AnalyticsPnlCategorySlug =
  (typeof ANALYTICS_PNL_CATEGORY_SLUGS)[number];

export type AnalyticsPnlNavCategorySlug = MarketNavCategorySlug;

export const ANALYTICS_PNL_CATEGORY_LABELS: Record<
  AnalyticsPnlCategorySlug,
  string
> = {
  ...MARKET_NAV_CATEGORY_LABELS,
  other: 'Autre',
};

export interface MarketCategoryPnlRow {
  slug: AnalyticsPnlCategorySlug;
  label: string;
  pnl: number;
  positionCount: number;
}

export {
  MARKET_NAV_CATEGORY_LABELS,
  resolveMarketNavCategoryLabel,
  resolveMarketNavCategorySlug,
  resolvePrimaryNavTagSlug,
} from '../market/nav-category.js';

/** @deprecated Use resolveMarketNavCategorySlug */
export const resolveAnalyticsCategorySlug = (
  slugs: string[] | null | undefined,
  category?: string | null,
  question?: string | null,
): AnalyticsPnlNavCategorySlug | null =>
  resolveMarketNavCategorySlug(slugs, category, question);

function positionTotalPnl(pos: EnrichedCopiedPosition): number {
  if (pos.status === 'closed') return pos.realizedPnl ?? 0;
  if (isOpenLikePositionStatus(pos.status)) return pos.unrealizedPnl ?? 0;
  return 0;
}

function categoryForPosition(
  pos: EnrichedCopiedPosition,
): AnalyticsPnlCategorySlug {
  return (
    resolveMarketNavCategorySlug(
      pos.marketTagSlugs,
      pos.marketCategory,
      pos.marketQuestion,
    ) ?? 'other'
  );
}

export function buildPnlByMarketCategory(
  positions: EnrichedCopiedPosition[],
): MarketCategoryPnlRow[] {
  const totals = new Map<
    AnalyticsPnlCategorySlug,
    { pnl: number; positionCount: number }
  >(
    ANALYTICS_PNL_CATEGORY_SLUGS.map((slug) => [
      slug,
      { pnl: 0, positionCount: 0 },
    ]),
  );

  for (const pos of positions) {
    const slug = categoryForPosition(pos);
    const bucket = totals.get(slug)!;
    bucket.pnl += positionTotalPnl(pos);
    bucket.positionCount += 1;
  }

  return ANALYTICS_PNL_CATEGORY_SLUGS.map((slug) => {
    const bucket = totals.get(slug)!;
    return {
      slug,
      label: ANALYTICS_PNL_CATEGORY_LABELS[slug],
      pnl: bucket.pnl,
      positionCount: bucket.positionCount,
    };
  });
}

/** Rows with at least one position — for compact chart rendering. */
export function filterActiveMarketCategoryRows(
  rows: MarketCategoryPnlRow[],
): MarketCategoryPnlRow[] {
  return rows.filter((row) => row.positionCount > 0);
}
