import type { WatchlistEntry } from '../entities/Watchlist.js';
import { isOpenLikePositionStatus } from '../positions/mark.js';
import type { EnrichedCopiedPosition } from '../services/copied-position-presenter.js';
import type {
  TraderAnalyticsRow,
  TraderAnalyticsTotals,
  TraderCloseReasonBreakdown,
} from '../types/trader-analytics.js';

type MutableTraderAnalytics = TraderAnalyticsRow & {
  holdDurationTotalMs: number;
  holdDurationCount: number;
};

function traderDisplayLabel(
  nickname: string | null,
  traderAddress: string,
): string {
  if (nickname) return nickname;
  if (traderAddress.length > 12) {
    return `${traderAddress.slice(0, 10)}…`;
  }
  return traderAddress;
}

export function emptyCloseReasonBreakdown(): TraderCloseReasonBreakdown {
  return {
    sl: 0,
    tp: 0,
    trailing: 0,
    preClose: 0,
    manual: 0,
    copyClose: 0,
    redemption: 0,
    other: 0,
  };
}

export function classifyCloseReason(
  reason: string | null,
): keyof TraderCloseReasonBreakdown {
  switch (reason) {
    case 'SL':
      return 'sl';
    case 'TP':
      return 'tp';
    case 'TRAILING':
      return 'trailing';
    case 'PRE_CLOSE_LOSS':
    case 'PRE_CLOSE_WIN':
      return 'preClose';
    case 'WEATHER_FORECAST_CHANGE':
    case 'WEATHER_BUCKET_EXIT':
      return 'other';
    case 'MANUAL':
    case 'KILL_SWITCH':
      return 'manual';
    case 'COPY_CLOSE':
    case 'COPY_DECREASE':
      return 'copyClose';
    case 'REDEMPTION':
      return 'redemption';
    default:
      return 'other';
  }
}

function emptyTraderStats(): Omit<
  TraderAnalyticsRow,
  | 'watchlistId'
  | 'traderAddress'
  | 'nickname'
  | 'simEnabled'
  | 'inWatchlistSim'
> {
  return {
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
  };
}

function rollupKey(watchlistId: number | null, traderAddress: string): string {
  return watchlistId != null ? `w:${watchlistId}` : `a:${traderAddress.toLowerCase()}`;
}

export function positionInvestedAmount(pos: EnrichedCopiedPosition): number {
  if (pos.status === 'closed') {
    return pos.entryInvestedAmount ?? 0;
  }
  if (isOpenLikePositionStatus(pos.status)) {
    return pos.quantity * pos.entryPrice;
  }
  return 0;
}

export function positionHoldDurationMs(pos: EnrichedCopiedPosition): number | null {
  if (!pos.openedAt || !pos.closedAt) return null;
  const ms =
    new Date(pos.closedAt).getTime() - new Date(pos.openedAt).getTime();
  return ms >= 0 ? ms : null;
}

function finalizeTrader(trader: MutableTraderAnalytics): TraderAnalyticsRow {
  trader.totalPnl = trader.realizedPnl + trader.unrealizedPnl;
  trader.roiPercent =
    trader.investedAmount > 0
      ? (trader.totalPnl / trader.investedAmount) * 100
      : null;
  trader.winRatePercent =
    trader.closedPositionCount > 0
      ? (trader.winningClosedCount / trader.closedPositionCount) * 100
      : null;
  trader.profitFactor =
    trader.grossLossesTotal > 0
      ? trader.grossWinsTotal / trader.grossLossesTotal
      : null;
  trader.avgWinPnl =
    trader.winningClosedCount > 0
      ? trader.grossWinsTotal / trader.winningClosedCount
      : null;
  trader.avgLossPnl =
    trader.closedPositionCount - trader.winningClosedCount > 0
      ? -(trader.grossLossesTotal /
          (trader.closedPositionCount - trader.winningClosedCount))
      : null;
  trader.avgHoldDurationMs =
    trader.holdDurationCount > 0
      ? trader.holdDurationTotalMs / trader.holdDurationCount
      : null;
  trader.holdDurationSampleCount = trader.holdDurationCount;

  const { holdDurationTotalMs: _a, holdDurationCount: _b, ...row } = trader;
  return row;
}

export function buildTraderAnalytics(
  watchlistEntries: WatchlistEntry[],
  enrichedPositions: EnrichedCopiedPosition[],
): TraderAnalyticsRow[] {
  const simWatchlist = watchlistEntries.filter((e) => e.simEnabled);
  const byKey = new Map<string, MutableTraderAnalytics>();

  for (const entry of simWatchlist) {
    const key = rollupKey(entry.id, entry.traderAddress);
    byKey.set(key, {
      watchlistId: entry.id,
      traderAddress: entry.traderAddress,
      nickname: entry.nickname,
      simEnabled: entry.simEnabled,
      inWatchlistSim: true,
      holdDurationTotalMs: 0,
      holdDurationCount: 0,
      ...emptyTraderStats(),
    });
  }

  for (const pos of enrichedPositions) {
    const address = pos.traderAddress ?? '';
    const key = rollupKey(pos.watchlistId, address || `id:${pos.watchlistId}`);
    let trader = byKey.get(key);

    if (!trader) {
      trader = {
        watchlistId: pos.watchlistId,
        traderAddress: address,
        nickname: pos.traderName,
        simEnabled: null,
        inWatchlistSim: false,
        holdDurationTotalMs: 0,
        holdDurationCount: 0,
        ...emptyTraderStats(),
      };
      byKey.set(key, trader);
    }

    trader.positionCount += 1;
    trader.feesTotal += pos.entryFees ?? 0;
    trader.investedAmount += positionInvestedAmount(pos);

    if (isOpenLikePositionStatus(pos.status)) {
      trader.openPositionCount += 1;
      trader.unrealizedPnl += pos.unrealizedPnl ?? 0;
    }

    if (pos.status === 'closed') {
      trader.closedPositionCount += 1;
      const realized = pos.realizedPnl ?? 0;
      trader.realizedPnl += realized;
      if (realized > 0) {
        trader.winningClosedCount += 1;
        trader.grossWinsTotal += realized;
      } else if (realized < 0) {
        trader.grossLossesTotal += Math.abs(realized);
      }
      trader.bestClosedPnl =
        trader.bestClosedPnl == null
          ? realized
          : Math.max(trader.bestClosedPnl, realized);
      trader.worstClosedPnl =
        trader.worstClosedPnl == null
          ? realized
          : Math.min(trader.worstClosedPnl, realized);

      const reasonKey = classifyCloseReason(pos.closeReason);
      trader.closeReasonBreakdown[reasonKey] += 1;

      const holdMs = positionHoldDurationMs(pos);
      if (holdMs != null) {
        trader.holdDurationTotalMs += holdMs;
        trader.holdDurationCount += 1;
      }
    }
  }

  return [...byKey.values()]
    .map(finalizeTrader)
    .sort((a, b) => {
      if (b.totalPnl !== a.totalPnl) return b.totalPnl - a.totalPnl;
      const labelA = traderDisplayLabel(a.nickname, a.traderAddress);
      const labelB = traderDisplayLabel(b.nickname, b.traderAddress);
      return labelA.localeCompare(labelB, 'fr');
    });
}

export function aggregateTraderAnalyticsTotals(
  rows: TraderAnalyticsRow[],
): TraderAnalyticsTotals {
  const totals: TraderAnalyticsTotals = {
    traderCount: rows.length,
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
