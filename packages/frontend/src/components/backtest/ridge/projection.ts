import type { RidgeScale, EnrichedSeries } from './types';

/** Point projeté en coordonnées pixel (prêt pour assemblage path). */
export interface ProjectedPoint {
  px: number;
  py: number;
  t: number;
}

/** Largeur d'un bucket en pixels pour le downsampling min-max. */
const BUCKET_PX = 4;

interface ValidPoint { px: number; py: number; t: number; }

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
  keptIndices.add(0);
  keptIndices.add(pts.length - 1);

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

/**
 * Projette une série enrichie dans le viewport courant.
 * - Applique downsampling min-max (borné par plotW/BUCKET_PX)
 * - Projection affine O(1) par point retenu
 * - Retourne ProjectedPoint[] — pas encore une string SVG
 * 
 * Coût : O(points retenus) ≤ O(plotW / BUCKET_PX)
 */
export function projectSeries(
  enriched: EnrichedSeries,
  scale: RidgeScale,
  voieTop: number,
): ProjectedPoint[] {
  const points = enriched.points;
  if (points.length === 0) return [];

  // 1. Projection affine vers pixels
  const valid: ValidPoint[] = [];
  for (const p of points) {
    if (p.price == null) continue;
    valid.push({
      px: scale.xPos(p.t),
      py: scale.yPos(p.price, voieTop),
      t: p.t,
    });
  }
  if (valid.length === 0) return [];

  // 3. Downsampling min-max si nécessaire (borné par viewport)
  const targetMaxPoints = Math.ceil(scale.plotW / BUCKET_PX) * 2;
  if (valid.length > targetMaxPoints) {
    return downsampleMinMax(valid, BUCKET_PX);
  }
  return valid;
}

/**
 * Assemble un path SVG `d` à partir de points projetés.
 * Segmentation par gap temporel (gapThreshold calculé sur les points projetés).
 */
export function buildPathFromProjected(
  projected: ProjectedPoint[],
  gapThreshold: number,
): string {
  if (projected.length === 0) return '';

  // Segmentation par gap (sur points déjà projetés + downsamples)
  const segments: ProjectedPoint[][] = [];
  let current: ProjectedPoint[] = [];

  for (const p of projected) {
    if (current.length > 0 && p.t - current[current.length - 1].t > gapThreshold) {
      segments.push(current);
      current = [];
    }
    current.push(p);
  }
  if (current.length) segments.push(current);

  // Reconstruire path
  const parts: string[] = [];
  for (const seg of segments) {
    for (let i = 0; i < seg.length; i++) {
      const p = seg[i];
      parts.push((i === 0 ? 'M' : 'L') + `${p.px.toFixed(1)},${p.py.toFixed(1)}`);
    }
  }
  return parts.join(' ');
}

/**
 * Calcule le gapThreshold (médiane des écarts temporels × 1.5, floor 60s).
 * Utilisé par buildPathFromProjected pour la segmentation.
 */
export function computeGapThreshold(projected: ProjectedPoint[]): number {
  if (projected.length < 2) return Infinity;

  const steps: number[] = [];
  for (let i = 1; i < projected.length; i++) {
    steps.push(projected[i].t - projected[i - 1].t);
  }
  steps.sort((a, b) => a - b);
  const medianStep = steps[Math.floor(steps.length / 2)];
  return Math.max(medianStep * 1.5, 60_000);
}