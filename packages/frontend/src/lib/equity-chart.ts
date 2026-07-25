import type { SimStateSnapshotSummary } from './simulation-snapshots';

export const CHART_CONFIG = {
  height: 150,
  minWidth: 320,
  margin: { top: 10, right: 16, bottom: 22, left: 52 },
  tickTarget: 4,
  maxXLabels: 5,
} as const;

export interface Point {
  t: number;
  equity: number;
}

export interface PlotLayout {
  width: number;
  points: Point[];
  minT: number;
  maxT: number;
  yMin: number;
  yMax: number;
  yTicks: number[];
  xTicks: Array<{ t: number; label: string }>;
  plotW: number;
  plotH: number;
}

function plotWidth(width: number): number {
  return Math.max(
    CHART_CONFIG.minWidth - CHART_CONFIG.margin.left - CHART_CONFIG.margin.right,
    width - CHART_CONFIG.margin.left - CHART_CONFIG.margin.right,
  );
}

export function buildPoints(items: SimStateSnapshotSummary[]): Point[] {
  return [...items]
    .sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    )
    .map((s) => ({
      t: new Date(s.createdAt).getTime(),
      equity: s.equity,
    }));
}

function niceYDomain(min: number, max: number): {
  yMin: number;
  yMax: number;
  yTicks: number[];
} {
  const span = max - min || Math.max(Math.abs(max), 1) * 0.1;
  const pad = span * 0.1;
  let lo = min - pad;
  let hi = max + pad;
  if (lo === hi) {
    lo -= 1;
    hi += 1;
  }
  const { tickTarget } = CHART_CONFIG;
  const roughStep = (hi - lo) / Math.max(tickTarget - 1, 1);
  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const norm = roughStep / magnitude;
  let step = magnitude;
  if (norm <= 1.5) step = magnitude;
  else if (norm <= 3) step = 2 * magnitude;
  else if (norm <= 7) step = 5 * magnitude;
  else step = 10 * magnitude;

  const yMin = Math.floor(lo / step) * step;
  const yMax = Math.ceil(hi / step) * step;
  const yTicks: number[] = [];
  for (let v = yMin; v <= yMax + step * 0.001; v += step) {
    yTicks.push(Math.round(v * 100) / 100);
  }
  return { yMin, yMax, yTicks };
}

function formatXLabel(t: number, spanMs: number): string {
  const d = new Date(t);
  if (spanMs <= 6 * 60 * 60 * 1000) {
    return d.toLocaleTimeString('fr-FR', {
      hour: '2-digit',
      minute: '2-digit',
    });
  }
  if (spanMs <= 48 * 60 * 60 * 1000) {
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

function buildXTicks(
  minT: number,
  maxT: number,
): Array<{ t: number; label: string }> {
  const span = maxT - minT;
  if (span <= 0) {
    return [{ t: minT, label: formatXLabel(minT, 0) }];
  }
  const count = Math.min(CHART_CONFIG.maxXLabels, 6);
  const ticks: Array<{ t: number; label: string }> = [];
  for (let i = 0; i < count; i++) {
    const t = minT + (span * i) / (count - 1);
    ticks.push({ t, label: formatXLabel(t, span) });
  }
  return ticks;
}

export function computeLayout(
  points: Point[],
  width: number,
  options?: { baselineAtZero?: boolean },
): PlotLayout | null {
  if (points.length < 2) return null;
  const minT = points[0]!.t;
  const maxT = points[points.length - 1]!.t;
  const equities = points.map((p) => p.equity);
  const rawMin = Math.min(...equities);
  const rawMax = Math.max(...equities);
  const { yMin, yMax, yTicks } = niceYDomain(
    options?.baselineAtZero && rawMin >= 0 ? 0 : rawMin,
    rawMax,
  );
  const plotW = plotWidth(width);
  return {
    width: plotW + CHART_CONFIG.margin.left + CHART_CONFIG.margin.right,
    points,
    minT,
    maxT,
    yMin,
    yMax,
    yTicks,
    xTicks: buildXTicks(minT, maxT),
    plotW,
    plotH: CHART_CONFIG.height - CHART_CONFIG.margin.top - CHART_CONFIG.margin.bottom,
  };
}

export function xPos(layout: PlotLayout, t: number): number {
  const span = layout.maxT - layout.minT || 1;
  return (
    CHART_CONFIG.margin.left +
    ((t - layout.minT) / span) * layout.plotW
  );
}

export function yPos(layout: PlotLayout, equity: number): number {
  const span = layout.yMax - layout.yMin || 1;
  return (
    CHART_CONFIG.margin.top +
    layout.plotH -
    ((equity - layout.yMin) / span) * layout.plotH
  );
}

export function linePath(layout: PlotLayout): string {
  return layout.points
    .map((pt, i) => {
      const x = xPos(layout, pt.t);
      const y = yPos(layout, pt.equity);
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

export function areaPath(layout: PlotLayout): string {
  const line = linePath(layout);
  if (!line) return '';
  const x0 = xPos(layout, layout.minT);
  const x1 = xPos(layout, layout.maxT);
  const yBase = CHART_CONFIG.margin.top + layout.plotH;
  return `${line} L${x1.toFixed(1)},${yBase} L${x0.toFixed(1)},${yBase} Z`;
}

export function nearestPointIndex(layout: PlotLayout, x: number): number {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < layout.points.length; i++) {
    const px = xPos(layout, layout.points[i]!.t);
    const dist = Math.abs(px - x);
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  }
  return best;
}

export function extremeIndices(points: Point[]): {
  minIdx: number;
  maxIdx: number;
} {
  let minIdx = 0;
  let maxIdx = 0;
  for (let i = 1; i < points.length; i++) {
    if (points[i]!.equity < points[minIdx]!.equity) minIdx = i;
    if (points[i]!.equity > points[maxIdx]!.equity) maxIdx = i;
  }
  return { minIdx, maxIdx };
}
