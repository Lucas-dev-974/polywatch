import { isOpenLikePositionStatus } from '../positions/mark.js';
import type { EnrichedCopiedPosition } from '../services/copied-position-presenter.js';
import type { SimSnapshotTrader } from '../types/sim-state-snapshot.js';

export interface TraderPnlSeriesPoint {
  t: string;
  pnl: number;
  snapshotId: number;
  /** True when the point is the live terminal value, not from a snapshot. */
  live?: boolean;
}

export interface TraderMarketOption {
  conditionId: string;
  label: string;
}

export interface TraderPnlSeriesSnapshotInput {
  id: number;
  createdAt: string | Date;
  traders: SimSnapshotTrader[];
  positions: EnrichedCopiedPosition[];
}

export interface BuildTraderPnlSeriesOptions {
  watchlistId: number;
  conditionId?: string | null;
  /** When set, appends a terminal point at this time if it differs from the last snapshot. */
  liveTerminal?: {
    at: string | Date;
    totalPnl: number;
  } | null;
}

export interface TraderPnlSeriesResult {
  points: TraderPnlSeriesPoint[];
  markets: TraderMarketOption[];
}

export interface TraderPnlSeriesResponse extends TraderPnlSeriesResult {
  currentTotalPnl: number;
}

export interface BuildTraderPnlSeriesResponseOptions {
  snapshots: TraderPnlSeriesSnapshotInput[];
  watchlistId: number;
  conditionId?: string | null;
  livePositions: EnrichedCopiedPosition[];
  liveAt?: string | Date;
}

export function toIsoTime(value: string | Date): string {
  return typeof value === 'string' ? value : value.toISOString();
}

export function toMs(value: string | Date): number {
  return new Date(value).getTime();
}

function marketLabel(pos: EnrichedCopiedPosition): string {
  if (pos.marketQuestion?.trim()) return pos.marketQuestion.trim();
  return `${pos.conditionId.slice(0, 10)}…`;
}

export function sumTraderPnlFromPositions(
  positions: EnrichedCopiedPosition[],
  watchlistId: number,
  conditionId?: string | null,
): number {
  let pnl = 0;
  for (const pos of positions) {
    if (pos.watchlistId !== watchlistId) continue;
    if (conditionId != null && pos.conditionId !== conditionId) continue;
    if (pos.status === 'closed') {
      pnl += pos.realizedPnl ?? 0;
    } else if (isOpenLikePositionStatus(pos.status)) {
      pnl += pos.unrealizedPnl ?? 0;
    }
  }
  return pnl;
}

export function collectTraderMarkets(
  positions: EnrichedCopiedPosition[],
  watchlistId: number,
): TraderMarketOption[] {
  const byCondition = new Map<string, TraderMarketOption>();
  for (const pos of positions) {
    if (pos.watchlistId !== watchlistId) continue;
    const existing = byCondition.get(pos.conditionId);
    if (existing) continue;
    byCondition.set(pos.conditionId, {
      conditionId: pos.conditionId,
      label: marketLabel(pos),
    });
  }
  return [...byCondition.values()].sort((a, b) =>
    a.label.localeCompare(b.label, 'fr'),
  );
}

export function mergeTraderMarkets(
  ...lists: TraderMarketOption[][]
): TraderMarketOption[] {
  const byCondition = new Map<string, TraderMarketOption>();
  for (const list of lists) {
    for (const item of list) {
      if (!byCondition.has(item.conditionId)) {
        byCondition.set(item.conditionId, item);
      }
    }
  }
  return [...byCondition.values()].sort((a, b) =>
    a.label.localeCompare(b.label, 'fr'),
  );
}

export function computeTraderPnlAtSnapshot(
  snapshot: Pick<TraderPnlSeriesSnapshotInput, 'traders' | 'positions'>,
  watchlistId: number,
  conditionId?: string | null,
): number {
  if (conditionId != null) {
    return sumTraderPnlFromPositions(
      snapshot.positions,
      watchlistId,
      conditionId,
    );
  }

  const trader = snapshot.traders.find((t) => t.watchlistId === watchlistId);
  if (trader) {
    return trader.realizedPnl + trader.unrealizedPnl;
  }

  return sumTraderPnlFromPositions(snapshot.positions, watchlistId);
}

export function buildTraderPnlSeriesFromSnapshots(
  snapshots: TraderPnlSeriesSnapshotInput[],
  options: BuildTraderPnlSeriesOptions,
): TraderPnlSeriesResult {
  const sorted = [...snapshots].sort(
    (a, b) => toMs(a.createdAt) - toMs(b.createdAt),
  );

  const marketsFromSnapshots =
    sorted.length > 0
      ? collectTraderMarkets(
          sorted[sorted.length - 1]!.positions,
          options.watchlistId,
        )
      : [];

  const points: TraderPnlSeriesPoint[] = [];
  let lastSecondKey: string | null = null;

  for (const snapshot of sorted) {
    const pnl = computeTraderPnlAtSnapshot(
      snapshot,
      options.watchlistId,
      options.conditionId,
    );
    const t = toIsoTime(snapshot.createdAt);
    const secondKey = t.slice(0, 19);
    if (secondKey === lastSecondKey && points.length > 0) {
      points[points.length - 1] = {
        t,
        pnl,
        snapshotId: snapshot.id,
      };
    } else {
      points.push({ t, pnl, snapshotId: snapshot.id });
      lastSecondKey = secondKey;
    }
  }

  const live = options.liveTerminal;
  const finalPoints =
    live != null
      ? appendLivePnlTerminalPoint(points, live.totalPnl, live.at)
      : points;

  return {
    points: finalPoints,
    markets: marketsFromSnapshots,
  };
}

export function appendLivePnlTerminalPoint(
  points: TraderPnlSeriesPoint[],
  totalPnl: number,
  at: string | Date = new Date(),
): TraderPnlSeriesPoint[] {
  if (points.length === 0) {
    return [
      {
        t: toIsoTime(at),
        pnl: totalPnl,
        snapshotId: 0,
        live: true,
      },
    ];
  }

  const liveT = toIsoTime(at);
  const last = points[points.length - 1]!;
  const sameTime = Math.abs(toMs(last.t) - toMs(liveT)) < 1000;
  const sameValue = last.pnl === totalPnl;
  if (!last.live && sameTime && sameValue) {
    return points;
  }

  return updateLivePnlSeriesPoint(points, totalPnl, at);
}

export function updateLivePnlSeriesPoint(
  points: TraderPnlSeriesPoint[],
  totalPnl: number,
  at: string | Date = new Date(),
): TraderPnlSeriesPoint[] {
  if (points.length === 0) return points;

  const next = [...points];
  const lastIdx = next.length - 1;
  const last = next[lastIdx]!;
  const liveT = toIsoTime(at);

  if (last.live) {
    next[lastIdx] = { ...last, t: liveT, pnl: totalPnl };
    return next;
  }

  next.push({
    t: liveT,
    pnl: totalPnl,
    snapshotId: last.snapshotId,
    live: true,
  });
  return next;
}

export function buildTraderPnlSeriesResponse(
  options: BuildTraderPnlSeriesResponseOptions,
): TraderPnlSeriesResponse {
  const liveTotalPnl = sumTraderPnlFromPositions(
    options.livePositions,
    options.watchlistId,
    options.conditionId,
  );
  const liveAt = options.liveAt ?? new Date();

  const series = buildTraderPnlSeriesFromSnapshots(options.snapshots, {
    watchlistId: options.watchlistId,
    conditionId: options.conditionId,
    liveTerminal: {
      at: liveAt,
      totalPnl: liveTotalPnl,
    },
  });

  const liveMarkets = collectTraderMarkets(
    options.livePositions,
    options.watchlistId,
  );

  return {
    points: series.points,
    markets: mergeTraderMarkets(series.markets, liveMarkets),
    currentTotalPnl: liveTotalPnl,
  };
}

export const TRADER_PNL_SERIES_HINTS = {
  selectTrader: 'Sélectionnez un trader.',
  noSnapshots:
    'Aucun snapshot — activez les snapshots auto ou créez-en un manuellement.',
  loadError: 'Impossible de charger la courbe PnL.',
} as const;
