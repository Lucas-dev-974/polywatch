import { isOpenLikePositionStatus } from '../positions/mark.js';
import type { EnrichedCopiedPosition } from '../services/copied-position-presenter.js';
import type { TraderPnlSeriesPoint } from './trader-pnl-series.js';
import {
  appendLivePnlTerminalPoint,
  toIsoTime,
  toMs,
} from './trader-pnl-series.js';

export interface MarketPnlSeriesSnapshotInput {
  id: number;
  createdAt: string | Date;
  positions: EnrichedCopiedPosition[];
}

export interface BuildMarketPnlSeriesOptions {
  conditionId: string;
  liveTerminal?: {
    at: string | Date;
    totalPnl: number;
  } | null;
}

export interface MarketPnlSeriesResult {
  points: TraderPnlSeriesPoint[];
}

export interface MarketPnlSeriesResponse extends MarketPnlSeriesResult {
  currentTotalPnl: number;
}

export interface BuildMarketPnlSeriesResponseOptions {
  snapshots: MarketPnlSeriesSnapshotInput[];
  conditionId: string;
  livePositions: EnrichedCopiedPosition[];
  liveAt?: string | Date;
}

export function sumMarketPnlFromPositions(
  positions: EnrichedCopiedPosition[],
  conditionId: string,
): number {
  let pnl = 0;
  for (const pos of positions) {
    if (pos.conditionId !== conditionId) continue;
    if (pos.status === 'closed') {
      pnl += pos.realizedPnl ?? 0;
    } else if (isOpenLikePositionStatus(pos.status)) {
      pnl += pos.unrealizedPnl ?? 0;
    }
  }
  return pnl;
}

export function buildMarketPnlSeriesFromSnapshots(
  snapshots: MarketPnlSeriesSnapshotInput[],
  options: BuildMarketPnlSeriesOptions,
): MarketPnlSeriesResult {
  const sorted = [...snapshots].sort(
    (a, b) => toMs(a.createdAt) - toMs(b.createdAt),
  );

  const points: TraderPnlSeriesPoint[] = [];
  let lastSecondKey: string | null = null;

  for (const snapshot of sorted) {
    const pnl = sumMarketPnlFromPositions(
      snapshot.positions,
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
  };
}

export function buildMarketPnlSeriesResponse(
  options: BuildMarketPnlSeriesResponseOptions,
): MarketPnlSeriesResponse {
  const liveTotalPnl = sumMarketPnlFromPositions(
    options.livePositions,
    options.conditionId,
  );
  const liveAt = options.liveAt ?? new Date();

  const series = buildMarketPnlSeriesFromSnapshots(options.snapshots, {
    conditionId: options.conditionId,
    liveTerminal: {
      at: liveAt,
      totalPnl: liveTotalPnl,
    },
  });

  return {
    points: series.points,
    currentTotalPnl: liveTotalPnl,
  };
}

export const MARKET_PNL_SERIES_HINTS = {
  selectMarket: 'Selectionnez un marche.',
  noSnapshots:
    'Aucun snapshot — activez les snapshots auto ou creez-en un manuellement.',
  loadError: 'Impossible de charger la courbe PnL.',
} as const;
