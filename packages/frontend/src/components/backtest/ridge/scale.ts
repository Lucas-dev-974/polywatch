import type { BacktestMarketSeriesDto } from '../../../api';
import type { RidgeScale, EnrichedSeries, EnrichedPoint } from './types';

export const VOIE_H = 48;
export const MARGIN_TOP = 12;

/** Espacement pixel minimum entre deux lignes de la grille Y (sous 0..1). */
const Y_GRID_MIN_GAP_PX = 10;

/** Pas de prix candidats pour la grille Y, du plus fin au plus grossier. */
const Y_GRID_STEPS = [0.1, 0.2, 0.25, 0.5];

/**
 * Niveaux de prix (0..1) de la grille Y pour une hauteur de voie donnée.
 * Plus la voie est haute, plus la grille est fine (le pas n'est réduit que
 * si les lignes restent espacées d'au moins `GRID_MIN_GAP_PX`).
 */
export function yTicksForVoieH(voieH = VOIE_H): number[] {
  const effPx = voieH - 8; // plage verticale couverte par un prix 0..1
  let step = Y_GRID_STEPS[Y_GRID_STEPS.length - 1];
  for (const s of Y_GRID_STEPS) {
    if (s * effPx >= Y_GRID_MIN_GAP_PX) {
      step = s;
      break;
    }
  }
  const ticks: number[] = [];
  for (let v = 0; v <= 1.0001; v += step) ticks.push(Math.min(1, Math.round(v * 100) / 100));
  return ticks;
}

/** Construit la géométrie pixel du ridge plot à partir du viewport et de la largeur. */
export function buildRidgeScale(
  minT: number,
  maxT: number,
  plotW: number,
  voieH = VOIE_H,
): RidgeScale {
  const spanT = maxT - minT || 1;
  return {
    minT,
    maxT,
    spanT,
    plotW,
    xPos: (t) => ((t - minT) / spanT) * plotW,
    yPos: (price, voieTop) =>
      voieTop + voieH - Math.min(1, Math.max(0, price)) * (voieH - 8) - 4,
    top: (i) => MARGIN_TOP + i * voieH,
  };
}

/** Facteur d'écart pour détecter une lacune : on casse le tracé quand l'écart
 * temporel entre deux points consécutifs dépasse 1.5× l'intervalle médian
 * (soit ~un tick manquant). */
const GAP_FACTOR = 1.5;
const GAP_FLOOR_MS = 60_000;

/** Largeur d'un bucket en pixels pour le downsampling min-max.
 * FIXE (pas dérivée de plotW) : 4px → ~plotW/4 points max par série. */
const BUCKET_PX = 4;

interface RawPoint { t: string; yesPrice: number | null; }
interface EnrichedPointInternal { t: number; price: number | null; }
interface ValidPoint { px: number; py: number; t: number; }

function isEnrichedSeries(series: BacktestMarketSeriesDto | EnrichedSeries): series is EnrichedSeries {
  return 'minT' in series;
}

/**
 * Downsampling min-max par bucket de largeur `bucketPx` pixels.
 * Conserve min et max Y par bucket, préserve l'ordre temporel, évite les doublons.
 * Toujours conserve le premier et le dernier point.
 */
function downsampleMinMax(pts: ValidPoint[], bucketPx: number): ValidPoint[] {
  if (pts.length === 0 || bucketPx < 2) return pts;
  
  const buckets = new Map<number, { minIdx: number; maxIdx: number }>();
  
  for (let i = 0; i < pts.length; i++) {
    const pxBucket = Math.floor(pts[i].px / bucketPx);
    const existing = buckets.get(pxBucket);
    if (!existing) {
      buckets.set(pxBucket, { minIdx: i, maxIdx: i });
    } else {
      if (pts[i].py < pts[existing.minIdx].py) existing.minIdx = i;
      if (pts[i].py > pts[existing.maxIdx].py) existing.maxIdx = i;
    }
  }
  
  // Collecter les indices à conserver, dans l'ordre
  const keptIndices = new Set<number>();
  keptIndices.add(0); // premier point
  keptIndices.add(pts.length - 1); // dernier point
  
  for (const { minIdx, maxIdx } of buckets.values()) {
    keptIndices.add(minIdx);
    keptIndices.add(maxIdx);
  }
  
  // Reconstruire dans l'ordre temporel
  const result: ValidPoint[] = [];
  for (let i = 0; i < pts.length; i++) {
    if (keptIndices.has(i)) result.push(pts[i]);
  }
  return result;
}

/** Trace le `d` de la courbe d'une série pour une row donnée.
 * `maxTicks` limite le tracé aux N derniers ticks (par ordre temporel).
 * Si `cutGaps` est vrai, les lacunes de données (point sans prix, ou tick
 * absent) coupent le tracé : les segments de part et d'autre ne sont pas reliés.
 * `clipUntilT` (si non-null) ne trace que les points dont t <= clipUntilT :
 * utilisé par le player de replay pour révéler les courbes progressivement. */
export function buildPath(
  series: BacktestMarketSeriesDto | EnrichedSeries,
  voieTop: number,
  scale: RidgeScale,
  maxTicks?: number | null,
  cutGaps = true,
  clipUntilT?: number | null,
): string {
  const enriched = isEnrichedSeries(series);
  
  // Extraire les points selon le type
  const rawPoints = enriched 
    ? (series as EnrichedSeries).points 
    : (series as BacktestMarketSeriesDto).points;
    
  const points = maxTicks && maxTicks > 0 ? rawPoints.slice(-maxTicks) : rawPoints;
  if (points.length === 0) return '';

  // Points valides (avec prix), conservés dans l'ordre temporel.
  // Pour les séries enrichies : t est déjà numérique, pas de Date.parse.
  const valid: ValidPoint[] = [];
  
  if (enriched) {
    const enrichedPoints = points as EnrichedPointInternal[];
    for (const p of enrichedPoints) {
      if (p.price == null) continue;
      const t = p.t; // déjà numérique
      if (clipUntilT != null && t > clipUntilT) continue;
      valid.push({ px: scale.xPos(t), py: scale.yPos(p.price, voieTop), t });
    }
  } else {
    // Fallback pour compatibilité (ancien code, tests, etc.)
    const rawPointsTyped = points as RawPoint[];
    for (const p of rawPointsTyped) {
      if (p.yesPrice == null) continue;
      const t = Date.parse(p.t);
      if (clipUntilT != null && t > clipUntilT) continue;
      valid.push({ px: scale.xPos(t), py: scale.yPos(p.yesPrice, voieTop), t });
    }
  }
  
  if (valid.length === 0) return '';

  // Intervalle temporel médian (cadence de poll). Un trou est un écart qui
  // dépasse 1.5× cette cadence (tick manqué).
  let gapThreshold = Infinity;
  if (cutGaps) {
    const steps: number[] = [];
    for (let i = 1; i < valid.length; i++) steps.push(valid[i].t - valid[i - 1].t);
    steps.sort((a, b) => a - b);
    const medianStep = steps.length ? steps[Math.floor(steps.length / 2)] : 0;
    gapThreshold = Math.max(medianStep * GAP_FACTOR, GAP_FLOOR_MS);
  }

  // === DOWNSAMPLING MIN-MAX ===
  // Ne downsample que si la série est plus grande que la cible visuelle (~plotW/BUCKET_PX points)
  const targetMaxPoints = Math.ceil(scale.plotW / BUCKET_PX) * 2;
  let shouldDownsample = valid.length > targetMaxPoints;
  
  // Segmentation en segments sans trou (sur données brutes valid, AVANT downsampling)
  const segments: ValidPoint[][] = [];
  let currentSegment: ValidPoint[] = [];
  
  for (let i = 0; i < valid.length; i++) {
    const p = valid[i];
    if (currentSegment.length > 0 && p.t - currentSegment[currentSegment.length - 1].t > gapThreshold) {
      segments.push(currentSegment);
      currentSegment = [];
    }
    currentSegment.push(p);
  }
  if (currentSegment.length) segments.push(currentSegment);
  
  // Downsampler chaque segment indépendamment si nécessaire
  const processedSegments: ValidPoint[][] = shouldDownsample
    ? segments.map(seg => downsampleMinMax(seg, BUCKET_PX))
    : segments;
  
  // Reconstruire le path : premier point de chaque segment en M, suivants en L
  const pathSegments: string[] = [];
  for (const seg of processedSegments) {
    for (let i = 0; i < seg.length; i++) {
      const p = seg[i];
      pathSegments.push((i === 0 ? 'M' : 'L') + `${p.px.toFixed(1)},${p.py.toFixed(1)}`);
    }
  }
  return pathSegments.join(' ');
}
