import type { UpDownPricePoint, OutcomeSideLabels } from './market-chart';

export type { OutcomeSideLabels };
import { DEBUG_EMPTY } from './market-chart-debug-format';

/** Type de prix à utiliser pour l'affichage des courbes. */
export type PriceMode = 'mid' | 'bid' | 'ask';

export const UPDOWN_CHART_CONFIG = {
  width: 600,
  height: 200,
  dialogHeight: 280,
  margin: { top: 16, right: 16, bottom: 28, left: 40 } as const,
  colors: { up: '#34d399', down: '#f87171' } as const,
  xTickCount: 5,
  yTicks: [0, 0.25, 0.5, 0.75, 1.0] as const,
} as const;

export interface UpDownPlotLayout {
  width: number;
  height: number;
  plotW: number;
  plotH: number;
  minT: number;
  maxT: number;
  upPath: string;
  downPath: string;
  yTicks: readonly number[];
  xTicks: Array<{ t: number; label: string }>;
}

interface TimeValuePoint {
  t: number;
  v: number | null;
}

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/**
 * Formate un timestamp pour l'axe X / tooltips selon la durée affichée.
 * - ≤ 15min : HH:MM:SS (résolution 1s crypto court)
 * - ≤ 6h : HH:MM
 * - ≤ 48h : JJ/MM HH:MM
 * - sinon : JJ/MM
 */
export function formatUpDownChartTime(unixMs: number, spanMs = 0): string {
  const d = new Date(unixMs);
  if (spanMs > 0 && spanMs <= 15 * 60_000) {
    return d.toLocaleTimeString('fr-FR', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  }
  if (spanMs <= 6 * HOUR_MS) {
    return d.toLocaleTimeString('fr-FR', {
      hour: '2-digit',
      minute: '2-digit',
    });
  }
  if (spanMs <= 2 * DAY_MS) {
    return d.toLocaleString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  }
  return d.toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
  });
}

export function formatUpDownPriceCents(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return DEBUG_EMPTY;
  return `${(value * 100).toFixed(1)}\u00A2`;
}

export function computeChartTimeRange(
  points: UpDownPricePoint[],
): { minT: number; maxT: number } | null {
  if (points.length < 2) return null;

  const firstT = points[0]!.t;
  const lastT = points[points.length - 1]!.t;

  return { minT: firstT, maxT: lastT };
}

export function buildPriceLinePath(
  points: TimeValuePoint[],
  minT: number,
  maxT: number,
  plotW: number,
  plotH: number,
  marginTop: number,
  marginLeft: number,
): string {
  const valid = points.filter((p) => p.v != null);
  if (valid.length < 2) return '';

  const rangeT = maxT - minT || 1;
  return valid
    .map((pt, i) => {
      const x = marginLeft + ((pt.t - minT) / rangeT) * plotW;
      const y = marginTop + (1 - pt.v!) * plotH;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

/**
 * Pas de temps « ronds » candidats pour l'axe X, du plus fin au plus large.
 * Chaque pas divise une journée entière (ou en est un multiple), ce qui permet
 * d'aligner les ticks sur des bornes propres (ex. :00, :15, :30, :45, heures
 * pleines, jours) plutôt que sur des fractions arbitraires du span.
 */
const X_TICK_STEPS_MS = [
  1_000, // 1 s
  5_000, // 5 s
  15_000, // 15 s
  30_000, // 30 s
  60_000, // 1 min
  5 * 60_000, // 5 min
  15 * 60_000, // 15 min
  30 * 60_000, // 30 min
  60 * 60_000, // 1 h
  2 * 60 * 60_000, // 2 h
  3 * 60 * 60_000, // 3 h
  6 * 60 * 60_000, // 6 h
  12 * 60 * 60_000, // 12 h
  DAY_MS, // 1 j
  2 * DAY_MS, // 2 j
  7 * DAY_MS, // 7 j
  14 * DAY_MS, // 14 j
  30 * DAY_MS, // 30 j
];

/** Largeur estimée (px) d'un label d'axe X, pour éviter le chevauchement. */
const X_TICK_LABEL_WIDTH_PX = 60;

/**
 * Construit les ticks de l'axe X alignés sur des pas de temps ronds.
 *
 * - Le nombre de ticks cible s'adapte à la largeur du plot (`plotWidth`) pour
 *   éviter le chevauchement des labels, plafonné par `tickCount`.
 * - Le pas est choisi parmi des valeurs « rondes » (15 min, 1 h, 3 h, 1 j…)
 *   de sorte que `span / step <= targetCount`.
 * - Les ticks sont alignés sur des bornes propres (début de pas rond ≥ minT).
 */
export function buildChartXTicks(
  minT: number,
  maxT: number,
  tickCount: number = UPDOWN_CHART_CONFIG.xTickCount,
  plotWidth?: number,
): Array<{ t: number; label: string }> {
  if (maxT <= minT) return [];

  const spanMs = maxT - minT;

  const widthBasedCount =
    plotWidth && plotWidth > 0
      ? Math.max(2, Math.floor(plotWidth / X_TICK_LABEL_WIDTH_PX))
      : tickCount;
  const targetCount = Math.max(2, Math.min(widthBasedCount, tickCount));

  let stepMs = spanMs / targetCount;
  for (const candidate of X_TICK_STEPS_MS) {
    if (spanMs / candidate <= targetCount) {
      stepMs = candidate;
      break;
    }
  }

  const firstTick = Math.ceil(minT / stepMs) * stepMs;

  const ticks: Array<{ t: number; label: string }> = [];
  const seenLabels = new Set<string>();
  for (let t = firstTick; t <= maxT; t += stepMs) {
    const label = formatUpDownChartTime(t, spanMs);
    if (seenLabels.has(label)) continue;
    seenLabels.add(label);
    ticks.push({ t, label });
  }

  return ticks;
}

export type OutcomeCurveSide = 'up' | 'down';

/** Resolve which price curve (side0/up vs side1/down) matches a position outcome. */
export function resolveOutcomeSide(
  outcome: string | null | undefined,
  labels?: OutcomeSideLabels | null,
): OutcomeCurveSide {
  const normalized = outcome?.trim().toLowerCase();
  if (normalized === 'down' || normalized === 'no') return 'down';
  if (normalized === 'up' || normalized === 'yes') return 'up';
  if (labels) {
    if (labels.side1.trim().toLowerCase() === normalized) return 'down';
    if (labels.side0.trim().toLowerCase() === normalized) return 'up';
  }
  return 'up';
}

/** Prix de la courbe correspondant à l'outcome de la position. */
export function resolveOutcomePrice(
  point: UpDownPricePoint,
  outcome: string | null | undefined,
  labels?: OutcomeSideLabels | null,
): number | null {
  const side = resolveOutcomeSide(outcome, labels);
  if (side === 'down') return point.down;
  return point.up ?? point.down;
}

/** Résout le prix d'un point selon le mode sélectionné (mid/bid/ask). */
export function resolvePriceByMode(
  point: UpDownPricePoint,
  mode: PriceMode,
  side: 'up' | 'down',
): number | null {
  if (mode === 'mid') return side === 'up' ? point.up : point.down;

  const m = point.metrics;
  if (!m) return side === 'up' ? point.up : point.down;

  if (mode === 'bid') {
    return side === 'up' ? m.upBid : m.downBid;
  }
  if (mode === 'ask') {
    return side === 'up' ? m.upAsk : m.downAsk;
  }
  return side === 'up' ? point.up : point.down;
}

/** Série temporelle pour un outcome donné, selon le mode de prix. */
function getOutcomeSeries(
  points: UpDownPricePoint[],
  outcome: string | null | undefined,
  mode: PriceMode = 'mid',
  labels?: OutcomeSideLabels | null,
): Array<{ t: number; v: number }> {
  const series: Array<{ t: number; v: number }> = [];
  const side = resolveOutcomeSide(outcome, labels);
  for (const point of points) {
    const v = resolvePriceByMode(point, mode, side);
    if (v != null) series.push({ t: point.t, v });
  }
  return series;
}

/** Interpole le prix de courbe au timestamp cible (aligné sur les segments SVG). */
export function interpolateOutcomePriceAtTime(
  points: UpDownPricePoint[],
  targetT: number,
  outcome: string | null | undefined,
  mode: PriceMode = 'mid',
  labels?: OutcomeSideLabels | null,
): number | null {
  const series = getOutcomeSeries(points, outcome, mode, labels);
  if (series.length === 0) return null;
  if (series.length === 1) return series[0]!.v;

  const first = series[0]!;
  const last = series[series.length - 1]!;
  if (targetT <= first.t) return first.v;
  if (targetT >= last.t) return last.v;

  for (let i = 0; i < series.length - 1; i++) {
    const a = series[i]!;
    const b = series[i + 1]!;
    if (targetT >= a.t && targetT <= b.t) {
      const dt = b.t - a.t;
      if (dt === 0) return a.v;
      const ratio = (targetT - a.t) / dt;
      return a.v + ratio * (b.v - a.v);
    }
  }
  return last.v;
}

export const BINARY_TP_BID_CAP = 0.99;

/** Estime le prix mid à partir du prix bid en utilisant le spread du point le plus proche. */
export function bidToMidPrice(
  bidPrice: number,
  points: UpDownPricePoint[],
  targetT: number,
  outcome: string | null | undefined,
  labels?: OutcomeSideLabels | null,
): number {
  const nearestIdx = findNearestPointIndex(points, targetT);
  const nearest = points[nearestIdx];
  if (!nearest?.metrics) return bidPrice;

  const side = resolveOutcomeSide(outcome, labels);
  const spreadPct =
    side === 'down'
      ? nearest.metrics.downSpreadPct
      : nearest.metrics.upSpreadPct;
  if (spreadPct == null || spreadPct <= 0) return bidPrice;

  // mid = bid / (1 - spreadPct/200)  car spreadPct = (ask-bid)/mid * 100
  const mid = bidPrice / (1 - spreadPct / 200);
  return Math.min(mid, 1);
}

/** Convertit un prix bid en prix affiché selon le mode Mid / Bid / Ask. */
export function bidToDisplayPrice(
  bidPrice: number,
  priceMode: PriceMode,
  points: UpDownPricePoint[],
  targetT: number,
  outcome: string | null | undefined,
  labels?: OutcomeSideLabels | null,
): number {
  if (priceMode === 'bid') return bidPrice;
  if (priceMode === 'mid') {
    return bidToMidPrice(bidPrice, points, targetT, outcome, labels);
  }
  const mid = bidToMidPrice(bidPrice, points, targetT, outcome, labels);
  return Math.min(mid * 2 - bidPrice, 1);
}

export interface PositionLevelThresholdsInput {
  entryBidVwap: number;
  /** Cost basis per share (entry price + fees/qty) — basis for SL/TP percent. */
  costPerShare: number;
  /** Stop-loss threshold as % of invested amount. */
  slPercent?: number | null;
  /** Take-profit threshold as % of invested amount. */
  tpPercent?: number | null;
}

export interface PositionLevelThresholds {
  entry: number;
  sl: number | null;
  tp: number | null;
}

/** Calcule les seuils affichés sur le graphique (pourcentage de la mise). */
export function computePositionLevelThresholds(
  levels: PositionLevelThresholdsInput,
): PositionLevelThresholds {
  const entry = levels.entryBidVwap;
  const cost = levels.costPerShare;

  let sl: number | null = null;
  if (levels.slPercent != null && levels.slPercent > 0 && cost > 0) {
    sl = Math.max(0, cost * (1 - levels.slPercent / 100));
  }

  let tp: number | null = null;
  if (levels.tpPercent != null && levels.tpPercent > 0 && cost > 0) {
    tp = Math.min(cost * (1 + levels.tpPercent / 100), BINARY_TP_BID_CAP);
  }

  return { entry, sl, tp };
}

/** Evite le chevauchement des labels quand les lignes sont proches. */
export function resolveLevelLabelYs(
  lineYs: number[],
  minGap = 18,
): number[] {
  const order = lineYs.map((y, i) => ({ y, i })).sort((a, b) => a.y - b.y);
  const labelYs = new Array<number>(lineYs.length);
  let prev = Number.NEGATIVE_INFINITY;

  for (const item of order) {
    let labelY = item.y - 4;
    if (labelY - prev < minGap) {
      labelY = prev + minGap;
    }
    labelYs[item.i] = labelY;
    prev = labelY;
  }

  return labelYs;
}

export function findNearestPointIndex(
  points: UpDownPricePoint[],
  targetT: number,
): number {
  let bestIdx = 0;
  let bestDiff = Math.abs(points[0]!.t - targetT);
  for (let i = 1; i < points.length; i++) {
    const diff = Math.abs(points[i]!.t - targetT);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestIdx = i;
    }
  }
  return bestIdx;
}

export function xPosFromTime(
  t: number,
  minT: number,
  maxT: number,
  plotW: number,
  marginLeft: number,
): number {
  return marginLeft + ((t - minT) / (maxT - minT || 1)) * plotW;
}

export function yPosFromPrice(
  price: number,
  plotH: number,
  marginTop: number,
): number {
  return marginTop + (1 - price) * plotH;
}

export function computeUpDownPlotLayout(
  points: UpDownPricePoint[],
  options: {
    width?: number;
    height?: number;
    priceMode?: PriceMode;
  } = {},
): UpDownPlotLayout | null {
  const timeRange = computeChartTimeRange(points);
  if (!timeRange) return null;

  const { minT, maxT } = timeRange;
  const width = options.width ?? UPDOWN_CHART_CONFIG.width;
  const height = options.height ?? UPDOWN_CHART_CONFIG.height;
  const margin = UPDOWN_CHART_CONFIG.margin;
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;
  const mode = options.priceMode ?? 'mid';

  const upPoints = points.map((p) => ({ t: p.t, v: resolvePriceByMode(p, mode, 'up') }));
  const downPoints = points.map((p) => ({ t: p.t, v: resolvePriceByMode(p, mode, 'down') }));

  return {
    width,
    height,
    plotW,
    plotH,
    minT,
    maxT,
    upPath: buildPriceLinePath(
      upPoints,
      minT,
      maxT,
      plotW,
      plotH,
      margin.top,
      margin.left,
    ),
    downPath: buildPriceLinePath(
      downPoints,
      minT,
      maxT,
      plotW,
      plotH,
      margin.top,
      margin.left,
    ),
    yTicks: UPDOWN_CHART_CONFIG.yTicks,
    xTicks: buildChartXTicks(minT, maxT),
  };
}
