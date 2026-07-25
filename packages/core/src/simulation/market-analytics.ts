import { isOpenLikePositionStatus } from '../positions/mark.js';
import type { EnrichedCopiedPosition } from '../services/copied-position-presenter.js';
import type {
  MarketAnalyticsRow,
  MarketAnalyticsTotals,
  MarketOutcomeBreakdown,
} from '../types/market-analytics.js';
import type { TraderCloseReasonBreakdown } from '../types/trader-analytics.js';
import {
  classifyCloseReason,
  emptyCloseReasonBreakdown,
  positionHoldDurationMs,
  positionInvestedAmount,
} from './trader-analytics.js';

type MutableMarketAnalytics = MarketAnalyticsRow & {
  holdDurationTotalMs: number;
  holdDurationCount: number;
};

function emptyOutcomeBreakdown(): MarketOutcomeBreakdown {
  return { yes: 0, no: 0, other: 0 };
}

function emptyMarketStats(): Omit<
  MarketAnalyticsRow,
  | 'conditionId'
  | 'question'
  | 'category'
  | 'tagSlugs'
  | 'marketResolved'
  | 'marketClosed'
> {
  return {
    traderCount: 0,
    positionCount: 0,
    openPositionCount: 0,
    closedPositionCount: 0,
    winningClosedCount: 0,
    realizedPnl: 0,
    unrealizedPnl: 0,
    totalPnl: 0,
    investedAmount: 0,
    roiPercent: null,
    winRatePercent: null,
    feesTotal: 0,
    bestClosedPnl: null,
    worstClosedPnl: null,
    grossWinsTotal: 0,
    grossLossesTotal: 0,
    profitFactor: null,
    avgWinPnl: null,
    avgLossPnl: null,
    avgHoldDurationMs: null,
    holdDurationSampleCount: 0,
    closeReasonBreakdown: emptyCloseReasonBreakdown(),
    outcomeBreakdown: emptyOutcomeBreakdown(),
  };
}

function classifyOutcome(outcome: string): keyof MarketOutcomeBreakdown {
  const lower = outcome.toLowerCase();
  if (lower === 'yes' || lower === 'no') return lower as 'yes' | 'no';
  return 'other';
}

function marketLabel(pos: EnrichedCopiedPosition): string {
  if (pos.marketQuestion?.trim()) return pos.marketQuestion.trim();
  return `${pos.conditionId.slice(0, 10)}…`;
}

function finalizeMarket(market: MutableMarketAnalytics): MarketAnalyticsRow {
  market.totalPnl = market.realizedPnl + market.unrealizedPnl;
  market.roiPercent =
    market.investedAmount > 0
      ? (market.totalPnl / market.investedAmount) * 100
      : null;
  market.winRatePercent =
    market.closedPositionCount > 0
      ? (market.winningClosedCount / market.closedPositionCount) * 100
      : null;
  market.profitFactor =
    market.grossLossesTotal > 0
      ? market.grossWinsTotal / market.grossLossesTotal
      : null;
  market.avgWinPnl =
    market.winningClosedCount > 0
      ? market.grossWinsTotal / market.winningClosedCount
      : null;
  market.avgLossPnl =
    market.closedPositionCount - market.winningClosedCount > 0
      ? -(market.grossLossesTotal /
          (market.closedPositionCount - market.winningClosedCount))
      : null;
  market.avgHoldDurationMs =
    market.holdDurationCount > 0
      ? market.holdDurationTotalMs / market.holdDurationCount
      : null;
  market.holdDurationSampleCount = market.holdDurationCount;

  const { holdDurationTotalMs: _a, holdDurationCount: _b, ...row } = market;
  return row;
}

export function buildMarketAnalytics(
  enrichedPositions: EnrichedCopiedPosition[],
): MarketAnalyticsRow[] {
  const byCondition = new Map<string, MutableMarketAnalytics>();

  for (const pos of enrichedPositions) {
    let market = byCondition.get(pos.conditionId);

    if (!market) {
      market = {
        conditionId: pos.conditionId,
        question: marketLabel(pos),
        category: pos.marketCategory,
        tagSlugs: pos.marketTagSlugs,
        marketResolved: pos.marketResolved,
        marketClosed: pos.marketClosed,
        holdDurationTotalMs: 0,
        holdDurationCount: 0,
        ...emptyMarketStats(),
      };
      byCondition.set(pos.conditionId, market);
    }

    // Count distinct traders
    const traderKey = pos.watchlistId != null
      ? `w:${pos.watchlistId}`
      : `a:${(pos.traderAddress ?? '').toLowerCase()}`;
    // We track trader count via a Set per conditionId
    // Use a separate map for trader tracking
    market.positionCount += 1;
    market.feesTotal += pos.entryFees ?? 0;
    market.investedAmount += positionInvestedAmount(pos);

    // Outcome breakdown
    const outcomeKey = classifyOutcome(pos.outcome);
    market.outcomeBreakdown[outcomeKey] += 1;

    if (isOpenLikePositionStatus(pos.status)) {
      market.openPositionCount += 1;
      market.unrealizedPnl += pos.unrealizedPnl ?? 0;
    }

    if (pos.status === 'closed') {
      market.closedPositionCount += 1;
      const realized = pos.realizedPnl ?? 0;
      market.realizedPnl += realized;
      if (realized > 0) {
        market.winningClosedCount += 1;
        market.grossWinsTotal += realized;
      } else if (realized < 0) {
        market.grossLossesTotal += Math.abs(realized);
      }
      market.bestClosedPnl =
        market.bestClosedPnl == null
          ? realized
          : Math.max(market.bestClosedPnl, realized);
      market.worstClosedPnl =
        market.worstClosedPnl == null
          ? realized
          : Math.min(market.worstClosedPnl, realized);

      const reasonKey = classifyCloseReason(pos.closeReason);
      market.closeReasonBreakdown[reasonKey] += 1;

      const holdMs = positionHoldDurationMs(pos);
      if (holdMs != null) {
        market.holdDurationTotalMs += holdMs;
        market.holdDurationCount += 1;
      }
    }
  }

  // Compute trader counts using a separate pass
  const traderSetByCondition = new Map<string, Set<number | string>>();
  for (const pos of enrichedPositions) {
    const key = pos.watchlistId != null
      ? `w:${pos.watchlistId}`
      : `a:${(pos.traderAddress ?? '').toLowerCase()}`;
    let set = traderSetByCondition.get(pos.conditionId);
    if (!set) {
      set = new Set();
      traderSetByCondition.set(pos.conditionId, set);
    }
    set.add(key);
  }
  for (const [conditionId, set] of traderSetByCondition) {
    const market = byCondition.get(conditionId);
    if (market) {
      market.traderCount = set.size;
    }
  }

  return [...byCondition.values()]
    .map(finalizeMarket)
    .sort((a, b) => {
      if (b.totalPnl !== a.totalPnl) return b.totalPnl - a.totalPnl;
      const labelA = a.question ?? a.conditionId;
      const labelB = b.question ?? b.conditionId;
      return labelA.localeCompare(labelB, 'fr');
    });
}

export function aggregateMarketAnalyticsTotals(
  rows: MarketAnalyticsRow[],
): MarketAnalyticsTotals {
  const totals: MarketAnalyticsTotals = {
    marketCount: rows.length,
    positionCount: 0,
    openPositionCount: 0,
    closedPositionCount: 0,
    winningClosedCount: 0,
    realizedPnl: 0,
    unrealizedPnl: 0,
    totalPnl: 0,
    investedAmount: 0,
    roiPercent: null,
    winRatePercent: null,
    feesTotal: 0,
    grossWinsTotal: 0,
    grossLossesTotal: 0,
    profitFactor: null,
    avgHoldDurationMs: null,
    closeReasonBreakdown: emptyCloseReasonBreakdown(),
    outcomeBreakdown: emptyOutcomeBreakdown(),
  };

  let holdDurationTotalMs = 0;
  let holdDurationCount = 0;

  for (const row of rows) {
    totals.positionCount += row.positionCount;
    totals.openPositionCount += row.openPositionCount;
    totals.closedPositionCount += row.closedPositionCount;
    totals.winningClosedCount += row.winningClosedCount;
    totals.realizedPnl += row.realizedPnl;
    totals.unrealizedPnl += row.unrealizedPnl;
    totals.totalPnl += row.totalPnl;
    totals.investedAmount += row.investedAmount;
    totals.feesTotal += row.feesTotal;
    totals.grossWinsTotal += row.grossWinsTotal;
    totals.grossLossesTotal += row.grossLossesTotal;

    for (const key of Object.keys(
      totals.closeReasonBreakdown,
    ) as (keyof TraderCloseReasonBreakdown)[]) {
      totals.closeReasonBreakdown[key] += row.closeReasonBreakdown[key];
    }

    for (const key of Object.keys(
      totals.outcomeBreakdown,
    ) as (keyof MarketOutcomeBreakdown)[]) {
      totals.outcomeBreakdown[key] += row.outcomeBreakdown[key];
    }

    if (row.avgHoldDurationMs != null && row.holdDurationSampleCount > 0) {
      holdDurationTotalMs += row.avgHoldDurationMs * row.holdDurationSampleCount;
      holdDurationCount += row.holdDurationSampleCount;
    }
  }

  totals.roiPercent =
    totals.investedAmount > 0
      ? (totals.totalPnl / totals.investedAmount) * 100
      : null;
  totals.winRatePercent =
    totals.closedPositionCount > 0
      ? (totals.winningClosedCount / totals.closedPositionCount) * 100
      : null;
  totals.profitFactor =
    totals.grossLossesTotal > 0
      ? totals.grossWinsTotal / totals.grossLossesTotal
      : null;
  totals.avgHoldDurationMs =
    holdDurationCount > 0 ? holdDurationTotalMs / holdDurationCount : null;

  return totals;
}
