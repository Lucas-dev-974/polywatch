import { createMemo, createSignal, onCleanup } from 'solid-js';
import type { BacktestMarketSeriesDto, BacktestPositionDto } from '../../../api';
import type { RidgeScale, TooltipInfo, VoieGroup, EnrichedSeries, EnrichedPoint } from './types';
import { MARGIN_TOP, VOIE_H } from './scale';
import { bucketLabel } from './group';
import { formatTs } from '../format';

// Distance verticale max pour considérer que le curseur "survole" une courbe.
const HOVER_BUCKET_TOLERANCE_PX = 8;

interface HoverDeps {
  plotSvgEl: () => SVGSVGElement | undefined;
  rootEl: () => HTMLDivElement | undefined;
  plotW: () => number;
  heightPlot: () => number;
  voies: () => VoieGroup[];
  scale: () => RidgeScale;
  maxTicks: () => number;
  isPlaying: () => boolean;
  /** Vrai quand un marker du player est survolé (masque le tooltip hover). */
  isHoveringPlayMarker: () => boolean;
}

/**
 * Gère l'état de hover (crosshair + tooltip) du ridge plot :
 * - Conversion de coordonnées SVG → container (tooltips positionnés en CSS).
 * - Recherche du bucket/courbe survolé via la position la plus proche.
 * - Construction du TooltipInfo affiché par RidgeTooltip.
 * - Throttling rAF : un seul update par frame pendant le survol.
 */
export function useRidgeHover(deps: HoverDeps) {
  const [hoveredT, setHoveredT] = createSignal<number | null>(null);
  const [hoveredY, setHoveredY] = createSignal<number | null>(null);

  const svgToContainer = (svgX: number, svgY: number): { x: number; y: number } => {
    const svg = deps.plotSvgEl();
    const root = deps.rootEl();
    if (!svg || !root) return { x: svgX, y: svgY };
    const svgRect = svg.getBoundingClientRect();
    const rootRect = root.getBoundingClientRect();
    // Facteur d'échelle SVG → pixels écran.
    const scaleX = svgRect.width / deps.plotW();
    const scaleY = svgRect.height / deps.heightPlot();
    return {
      x: svgRect.left - rootRect.left + svgX * scaleX,
      y: svgRect.top - rootRect.top + svgY * scaleY,
    };
  };

  // nearestPrice en recherche dichotomique (points triés par temps).
  // Supporte à la fois BacktestMarketSeriesDto (fallback) et EnrichedSeries (chemin chaud).
  const nearestPrice = (s: BacktestMarketSeriesDto | EnrichedSeries, t: number): number | null => {
    const isEnriched = 'minT' in s;
    const n = deps.maxTicks();
    const points = isEnriched
      ? (s as EnrichedSeries).points
      : (s as BacktestMarketSeriesDto).points;
    const sliced = n > 0 ? points.slice(-n) : points;
    if (sliced.length === 0) return null;
    
    // Early exit si hors bornes
    if (isEnriched) {
      const enriched = s as EnrichedSeries;
      if (t < enriched.minT || t > enriched.maxT) return null;
    }
    
    let lo = 0;
    let hi = sliced.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const midT = isEnriched 
        ? (sliced[mid] as EnrichedPoint).t 
        : Date.parse((sliced[mid] as BacktestMarketSeriesDto).t);
      if (midT < t) lo = mid + 1;
      else hi = mid;
    }
    let best: number | null = null;
    let bestDist = Infinity;
    for (const cand of [lo - 1, lo, lo + 1]) {
      if (cand < 0 || cand >= sliced.length) continue;
      const p = sliced[cand];
      if (isEnriched) {
        const ep = p as EnrichedPoint;
        if (ep.price == null) continue;
        const d = Math.abs(ep.t - t);
        if (d < bestDist) {
          bestDist = d;
          best = ep.price;
        }
      } else {
        const dp = p as { yesPrice: number | null; t: string };
        if (dp.yesPrice == null) continue;
        const d = Math.abs(Date.parse(dp.t) - t);
        if (d < bestDist) {
          bestDist = d;
          best = dp.yesPrice;
        }
      }
    }
    return best;
  };

  const hoveredVoieIndex = createMemo<number | null>(() => {
    const y = hoveredY();
    const list = deps.voies();
    if (y == null || list.length === 0) return null;
    const rel = y - MARGIN_TOP;
    if (rel < 0 || rel >= deps.heightPlot()) return null;
    return Math.floor(rel / VOIE_H);
  });

  // Clé unique d'un bucket dans une row : `${voieIndex}:${bucketIndex}`.
  // null si le curseur n'est sur aucune courbe spécifique.
  const hoveredBucketKey = createMemo<string | null>(() => {
    const t = hoveredT();
    const y = hoveredY();
    const idx = hoveredVoieIndex();
    if (t == null || y == null || idx == null) return null;
    const sc = deps.scale();
    const group = deps.voies()[idx];
    if (!group) return null;
    const voieTop = sc.top(idx);
    let bestKey: string | null = null;
    let bestDist = Infinity;
    for (let bi = 0; bi < group.buckets.length; bi++) {
      const b = group.buckets[bi];
      const price = nearestPrice(b.series, t);
      if (price == null) continue;
      const py = sc.yPos(price, voieTop);
      const d = Math.abs(py - y);
      if (d < bestDist) {
        bestDist = d;
        bestKey = `${idx}:${bi}`;
      }
    }
    return bestDist <= HOVER_BUCKET_TOLERANCE_PX ? bestKey : null;
  });

  const tooltipInfo = createMemo<TooltipInfo | null>(() => {
    // P10 : masquer le tooltip hover pendant le replay ou au survol d'un marker.
    if (deps.isPlaying() || deps.isHoveringPlayMarker()) return null;
    const t = hoveredT();
    const idx = hoveredVoieIndex();
    const group = idx == null ? null : deps.voies()[idx];
    if (t == null || !group) return null;
    const key = hoveredBucketKey();
    // Si une courbe précise est survolée, on ne garde que son bucket.
    // Sinon, on affiche tous les buckets de la row.
    const selectedBuckets = key != null
      ? group.buckets.filter((_, bi) => `${idx}:${bi}` === key)
      : group.buckets;
    const buckets = selectedBuckets.map((b) => ({
      color: b.color,
      label: bucketLabel(b.series),
      price: nearestPrice(b.series, t),
      position: b.position,
    }));
    const positionBuckets = buckets.filter((b) => b.position);
    return {
      city: group.city ?? '—',
      date: group.date,
      forecastMean: group.forecastMean,
      forecastStdDev: group.forecastStdDev,
      cursorLabel: formatTs(new Date(t).toISOString()),
      buckets,
      hasPositions: positionBuckets.length > 0,
      positionBuckets,
    };
  });

  // ── Hover throttling : un seul update de tooltip par frame (rAF) ─────
  let pendingHover: { t: number; y: number } | null = null;
  let rafId: number | null = null;
  const flushHover = () => {
    rafId = null;
    if (pendingHover) {
      setHoveredT(pendingHover.t);
      setHoveredY(pendingHover.y);
      pendingHover = null;
    }
  };
  const scheduleHover = (t: number, y: number) => {
    pendingHover = { t, y };
    if (rafId == null) rafId = requestAnimationFrame(flushHover);
  };
  onCleanup(() => {
    if (rafId != null) cancelAnimationFrame(rafId);
  });

  const clearHover = () => {
    if (rafId != null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    pendingHover = null;
    setHoveredT(null);
    setHoveredY(null);
  };

  return {
    hoveredT,
    hoveredY,
    hoveredVoieIndex,
    hoveredBucketKey,
    tooltipInfo,
    svgToContainer,
    scheduleHover,
    clearHover,
  };
}
