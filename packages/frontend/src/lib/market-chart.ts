import { displayAlgoSymbol } from './algo-market-display';
import { api } from '../api';
import { formatShortDateTime } from './date';

export const TIMEFRAMES = [
  { value: '1h', label: '1h' },
  { value: '6h', label: '6h' },
  { value: '1d', label: '1j' },
  { value: '1w', label: '1sem' },
  { value: '1m', label: '1mois' },
  { value: 'max', label: 'Max' },
] as const;

/** Résolution d'affichage pour les marchés crypto Up/Down courts (5m / 10m / 1h). */
export const CRYPTO_CHART_RESOLUTIONS = [
  { value: '1s', label: '1s' },
  { value: '1min', label: '1min' },
] as const;

export type CryptoChartResolution = (typeof CRYPTO_CHART_RESOLUTIONS)[number]['value'];

/** Intervalles crypto courts : sélecteur de résolution (1s / 1min) au lieu de période. */
export const SHORT_CRYPTO_CHART_INTERVALS = new Set(['5m', '10m', '1h']);

export function usesCryptoChartResolution(
  cryptoSymbol: string | null | undefined,
  interval: string | null | undefined,
): boolean {
  if (!cryptoSymbol || !interval) return false;
  return SHORT_CRYPTO_CHART_INTERVALS.has(interval);
}

/**
 * Décime les points Up/Down à un point par bucket (dernier tick du bucket).
 * Utilisé pour la résolution 1min sur les marchés crypto courts.
 */
export function decimateUpDownPoints(
  points: UpDownPricePoint[],
  bucketMs: number,
): UpDownPricePoint[] {
  if (points.length === 0 || bucketMs <= 0) return points;

  const sorted = [...points].sort((a, b) => a.t - b.t);
  const out: UpDownPricePoint[] = [];
  let bucketStart = sorted[0]!.t;
  let lastInBucket: UpDownPricePoint | null = null;

  for (const point of sorted) {
    if (point.t >= bucketStart + bucketMs) {
      if (lastInBucket) out.push(lastInBucket);
      while (point.t >= bucketStart + bucketMs) {
        bucketStart += bucketMs;
      }
    }
    lastInBucket = point;
  }
  if (lastInBucket) out.push(lastInBucket);
  return out;
}

export type LiquidityStatus = 'ok' | 'partial' | 'illiquid';

export interface AlgoPriceTickMetrics {
  upBid: number | null;
  upAsk: number | null;
  downBid: number | null;
  downAsk: number | null;
  upSpreadPct: number | null;
  downSpreadPct: number | null;
  upAskVwap: number | null;
  downAskVwap: number | null;
  upLiquidityStatus: LiquidityStatus | null;
  downLiquidityStatus: LiquidityStatus | null;
  priceGap: number | null;
  secondsUntilEnd: number | null;
  bookStalenessMs: number | null;
  wsHealthy: boolean | null;
  upBidSize: number | null;
  upAskSize: number | null;
  downBidSize: number | null;
  downAskSize: number | null;
  upLastTradePrice: number | null;
  downLastTradePrice: number | null;
  upLastTradeSize: number | null;
  downLastTradeSize: number | null;
  upDelta1s: number | null;
  downDelta1s: number | null;
  openPositionsCount: number;
  openExposureUsd: number | null;
  unrealizedPnl: number | null;
  lastSignalOutcome: string | null;
  lastSignalConfidence: number | null;
  lastSignalStrategyId: string | null;
  signalAgeMs: number | null;
  lastAbstainReason: string | null;
}

export interface UpDownPricePoint {
  t: number;
  up: number | null;
  down: number | null;
  metrics?: AlgoPriceTickMetrics;
}

/** Dynamic outcome labels for side0 (up curve) / side1 (down curve). */
export interface OutcomeSideLabels {
  side0: string;
  side1: string;
}

export interface MarketChartResponse {
  conditionId: string;
  points: UpDownPricePoint[];
  outcomeLabels?: OutcomeSideLabels | null;
}

/** One position that can drive chart overlays for a market. */
export interface MarketChartPosition {
  id: number;
  outcome: string;
  mode: string;
  status: string;
  assetId: string;
  entryPrice: number;
  entryBidVwap: number;
  slBidPoints: number | null;
  tpBidPoints: number | null;
  exitBidVwap: number | null;
  openedAt: string | null;
  closedAt: string | null;
  /** Shares for MOS comparison (open qty or filled entry qty). */
  positionQuantity: number | null;
  /** Optional label fragment (e.g. t+30s) for the position selector. */
  entryOffsetLabel?: string | null;
}

/** Shared context for the Up/Down market chart dialog. */
export interface MarketChartContext {
  conditionId: string;
  /** Initial / active position id (selection). */
  copiedPositionId?: number | null;
  /**
   * All positions on this market. When present and non-empty, the dialog
   * derives overlays / exit attempts / MOS from the selected position only
   * (flat fields below are ignored for rendering).
   */
  chartPositions?: MarketChartPosition[];
  assetId?: string | null;
  cryptoSymbol?: string | null;
  interval?: string | null;
  question?: string | null;
  marketStartAt?: string | null;
  marketEndAt?: string | null;
  /** Prix d'entrée VWAP de la position (pour affichage sur le graphique). */
  entryBidVwap?: number | null;
  /** Prix d'entrée (ask payé) pour 1 share. */
  entryPrice?: number | null;
  /** Seuil Stop Loss en points bid. */
  slBidPoints?: number | null;
  /** Seuil Take Profit en points bid. */
  tpBidPoints?: number | null;
  /** Date d'ouverture de la position (ISO string). */
  openedAt?: string | null;
  /** Date de clôture de la position (ISO string) — pour les positions fermées. */
  closedAt?: string | null;
  /** Outcome de la position (Up, Down, Yes, etc.) pour aligner le marqueur sur la courbe. */
  outcome?: string | null;
  /** Fill price de la dernière SELL execution (prix de sortie). */
  exitBidVwap?: number | null;
  /** Quantité de la position en shares (ouverte ou au fill d'entrée). */
  positionQuantity?: number | null;
  /** Dynamic side0/side1 labels from market metadata (optional until chart loads). */
  outcomeLabels?: OutcomeSideLabels | null;
}

/** Flat overlay fields derived from the active chart position (or legacy flat ctx). */
export interface ActiveMarketChartPosition {
  id: number | null;
  assetId: string | null;
  entryPrice: number | null;
  entryBidVwap: number | null;
  slBidPoints: number | null;
  tpBidPoints: number | null;
  exitBidVwap: number | null;
  openedAt: string | null;
  closedAt: string | null;
  outcome: string | null;
  positionQuantity: number | null;
  mode: string | null;
  status: string | null;
  entryOffsetLabel: string | null;
}

function chartPositionToActive(pos: MarketChartPosition): ActiveMarketChartPosition {
  return {
    id: pos.id,
    assetId: pos.assetId,
    entryPrice: pos.entryPrice,
    entryBidVwap: pos.entryBidVwap,
    slBidPoints: pos.slBidPoints,
    tpBidPoints: pos.tpBidPoints,
    exitBidVwap: pos.exitBidVwap,
    openedAt: pos.openedAt,
    closedAt: pos.closedAt,
    outcome: pos.outcome,
    positionQuantity: pos.positionQuantity,
    mode: pos.mode,
    status: pos.status,
    entryOffsetLabel: pos.entryOffsetLabel ?? null,
  };
}

function flatContextToActive(ctx: MarketChartContext): ActiveMarketChartPosition | null {
  if (
    ctx.copiedPositionId == null &&
    (ctx.entryBidVwap == null || ctx.entryBidVwap <= 0) &&
    ctx.assetId == null
  ) {
    return null;
  }
  return {
    id: ctx.copiedPositionId ?? null,
    assetId: ctx.assetId ?? null,
    entryPrice: ctx.entryPrice ?? null,
    entryBidVwap: ctx.entryBidVwap ?? null,
    slBidPoints: ctx.slBidPoints ?? null,
    tpBidPoints: ctx.tpBidPoints ?? null,
    exitBidVwap: ctx.exitBidVwap ?? null,
    openedAt: ctx.openedAt ?? null,
    closedAt: ctx.closedAt ?? null,
    outcome: ctx.outcome ?? null,
    positionQuantity: ctx.positionQuantity ?? null,
    mode: null,
    status: null,
    entryOffsetLabel: null,
  };
}

/**
 * Resolve the active position for chart overlays.
 * When `chartPositions` is non-empty, it is the sole source of truth.
 */
export function resolveActiveChartPosition(
  ctx: MarketChartContext,
  selectedId: number | null | undefined,
): ActiveMarketChartPosition | null {
  const positions = ctx.chartPositions ?? [];
  if (positions.length > 0) {
    const preferred =
      selectedId != null
        ? positions.find((p) => p.id === selectedId)
        : undefined;
    return chartPositionToActive(preferred ?? positions[0]!);
  }
  return flatContextToActive(ctx);
}

export function listChartPositions(ctx: MarketChartContext): MarketChartPosition[] {
  if (ctx.chartPositions && ctx.chartPositions.length > 0) {
    return ctx.chartPositions;
  }
  const flat = flatContextToActive(ctx);
  if (!flat || flat.id == null) return [];
  return [
    {
      id: flat.id,
      outcome: flat.outcome ?? '—',
      mode: flat.mode ?? '—',
      status: flat.status ?? '—',
      assetId: flat.assetId ?? '',
      entryPrice: flat.entryPrice ?? 0,
      entryBidVwap: flat.entryBidVwap ?? 0,
      slBidPoints: flat.slBidPoints,
      tpBidPoints: flat.tpBidPoints,
      exitBidVwap: flat.exitBidVwap,
      openedAt: flat.openedAt,
      closedAt: flat.closedAt,
      positionQuantity: flat.positionQuantity,
      entryOffsetLabel: flat.entryOffsetLabel,
    },
  ];
}

export function formatChartPositionSelectorLabel(
  pos: MarketChartPosition,
  outcomeLabels?: OutcomeSideLabels | null,
): string {
  const modeLabel = pos.mode === 'real' ? 'Réel' : pos.mode === 'sim' ? 'Sim' : pos.mode;
  const outcomeLabel = displayOutcomeLabel(pos.outcome, outcomeLabels);
  const parts = [`#${pos.id}`, modeLabel, outcomeLabel];
  if (pos.entryOffsetLabel) parts.push(pos.entryOffsetLabel);
  if (pos.status && pos.status !== '—') parts.push(pos.status);
  return parts.join(' · ');
}

/** Map stored outcome (YES/NO/up/down) to dynamic market label when available. */
export function displayOutcomeLabel(
  outcome: string,
  labels?: OutcomeSideLabels | null,
): string {
  if (!labels) return outcome;
  const normalized = outcome.trim().toLowerCase();
  if (normalized === 'yes' || normalized === 'up') return labels.side0;
  if (normalized === 'no' || normalized === 'down') return labels.side1;
  return outcome;
}

export function hasUsableEntryBidVwap(
  entryBidVwap: number | null | undefined,
): boolean {
  return entryBidVwap != null && entryBidVwap > 0;
}

export async function fetchMarketChart(
  conditionId: string,
  timeframe?: string,
): Promise<MarketChartResponse> {
  const params =
    timeframe && timeframe !== 'max'
      ? `?timeframe=${encodeURIComponent(timeframe)}`
      : '';
  return api<MarketChartResponse>(
    `/algo/market-chart/${encodeURIComponent(conditionId)}${params}`,
  );
}

export function parseMarketWindowMs(
  iso: string | null | undefined,
): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

export function formatMarketWindow(
  start: string | null | undefined,
  end: string | null | undefined,
): string {
  if (!start && !end) return 'N/A';
  const startLabel = start ? formatShortDateTime(start) : 'N/A';
  const endLabel = end ? formatShortDateTime(end) : 'N/A';
  return `${startLabel} → ${endLabel}`;
}

export function buildMarketChartTitle(
  cryptoSymbol: string | null | undefined,
  interval: string | null | undefined,
): string {
  const symbol = displayAlgoSymbol(cryptoSymbol ?? null);
  if (symbol !== '—' && interval) return `${symbol} · ${interval}`;
  if (symbol !== '—') return symbol;
  return 'Cours marché';
}

export function computeChartMetricSummaries(points: UpDownPricePoint[]): {
  avgUpSpreadPct: number | null;
  avgDownSpreadPct: number | null;
  maxPriceGap: number | null;
} {
  const upSpreads: number[] = [];
  const downSpreads: number[] = [];
  const gaps: number[] = [];

  for (const p of points) {
    const m = p.metrics;
    if (!m) continue;
    if (m.upSpreadPct != null) upSpreads.push(m.upSpreadPct);
    if (m.downSpreadPct != null) downSpreads.push(m.downSpreadPct);
    if (m.priceGap != null) gaps.push(m.priceGap);
  }

  const avg = (values: number[]) =>
    values.length > 0
      ? values.reduce((a, b) => a + b, 0) / values.length
      : null;

  return {
    avgUpSpreadPct: avg(upSpreads),
    avgDownSpreadPct: avg(downSpreads),
    maxPriceGap: gaps.length > 0 ? Math.max(...gaps) : null,
  };
}

export interface GenericMarketChartPoint {
  t: number;
  bestBid: number | null;
  bestAsk: number | null;
  midPrice: number | null;
  spread: number | null;
  spreadPercent: number | null;
  lastTradePrice: number | null;
  metrics?: {
    openPositionsCount: number;
    openExposureUsd: number | null;
    unrealizedPnl: number | null;
  } | null;
}

export function genericPointToUpDownPricePoint(
  p: GenericMarketChartPoint,
): UpDownPricePoint {
  return {
    t: p.t,
    up: p.midPrice,
    down: null,
    metrics: {
      upBid: p.bestBid,
      upAsk: p.bestAsk,
      downBid: null,
      downAsk: null,
      upSpreadPct: p.spreadPercent,
      downSpreadPct: null,
      upAskVwap: null,
      downAskVwap: null,
      upLiquidityStatus: null,
      downLiquidityStatus: null,
      priceGap: null,
      secondsUntilEnd: null,
      bookStalenessMs: null,
      wsHealthy: null,
      upBidSize: null,
      upAskSize: null,
      downBidSize: null,
      downAskSize: null,
      upLastTradePrice: p.lastTradePrice,
      downLastTradePrice: null,
      upLastTradeSize: null,
      downLastTradeSize: null,
      upDelta1s: null,
      downDelta1s: null,
      openPositionsCount: p.metrics?.openPositionsCount ?? 0,
      openExposureUsd: p.metrics?.openExposureUsd ?? null,
      unrealizedPnl: p.metrics?.unrealizedPnl ?? null,
      lastSignalOutcome: null,
      lastSignalConfidence: null,
      lastSignalStrategyId: null,
      signalAgeMs: null,
      lastAbstainReason: null,
    } satisfies AlgoPriceTickMetrics,
  };
}
