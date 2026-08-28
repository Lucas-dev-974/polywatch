import type { WeatherTimelineBucketData } from '../weather-timeline-types';
import type { ChartPoint, SegmentedBucket } from './types';

/**
 * Prix moyen d'un bucket, en excluant les zéros finaux (effondrement de
 * résolution en fin de vie). Sans cette exclusion, un bucket perdant qui
 * résout à 0 ferait chuter sa moyenne à 0 malgré une cotation significative
 * pendant sa vie.
 */
export function averagePriceOf(b: WeatherTimelineBucketData): number | null {
  const prices = b.series
    .map((p) => p.y)
    .filter((y): y is number => y != null);
  if (prices.length === 0) return null;
  let end = prices.length;
  while (end > 0 && prices[end - 1] === 0) end--;
  const meaningful = prices.slice(0, end);
  if (meaningful.length === 0) return null;
  return meaningful.reduce((a, c) => a + c, 0) / meaningful.length;
}

/** Filtre les buckets dont le prix moyen est < seuil (si minPrice > 0). */
export function filterBucketsByMinPrice(
  buckets: WeatherTimelineBucketData[],
  minPrice: number,
  alwaysShowConditionId?: string,
): WeatherTimelineBucketData[] {
  if (minPrice <= 0) return buckets;
  return buckets.filter((b) => {
    if (alwaysShowConditionId && b.conditionId === alwaysShowConditionId) return true;
    const avg = averagePriceOf(b);
    return avg != null && avg >= minPrice;
  });
}

/** Dernier prix d'un bucket segmenté (dernier point du dernier segment). */
export function lastPriceOf(s: SegmentedBucket): number | null {
  for (let i = s.segments.length - 1; i >= 0; i--) {
    const seg = s.segments[i]!;
    if (seg.length > 0) return seg[seg.length - 1]!.y;
  }
  return null;
}

/** Bornes temporelles min/max d'une liste de points. */
export function boundsOf(points: ChartPoint[]): { minT: number; maxT: number } {
  if (points.length === 0) return { minT: 0, maxT: 1 };
  let minT = Infinity;
  let maxT = -Infinity;
  for (const p of points) {
    if (p.t < minT) minT = p.t;
    if (p.t > maxT) maxT = p.t;
  }
  return { minT, maxT };
}

/**
 * Downsampling min-max : réduit une série de points (triés par t) à au plus
 * `maxPoints` points en conservant, par groupe, le min et le max de y.
 * Préserve l'ordre temporel et garde toujours le premier et le dernier point.
 *
 * Utilisé pour borner le coût de rendu SVG et du crosshair quand une fenêtre
 * temporelle non bornée (dialog Positions) renvoie des milliers de points par
 * bucket. Sans ce garde-fou, le path SVG devient énorme et le crosshair
 * parcourt tous les points à chaque mousemove → freeze de l'UI.
 */
export function downsampleMinMax(points: ChartPoint[], maxPoints: number): ChartPoint[] {
  if (points.length <= maxPoints || maxPoints < 2) return points;
  const bucketSize = points.length / maxPoints;
  const out: ChartPoint[] = [points[0]!];
  let i = 1;
  while (i < points.length - 1) {
    const end = Math.min(points.length - 1, Math.floor(i + bucketSize));
    let minIdx = i;
    let maxIdx = i;
    for (let j = i + 1; j <= end; j++) {
      if (points[j]!.y < points[minIdx]!.y) minIdx = j;
      if (points[j]!.y > points[maxIdx]!.y) maxIdx = j;
    }
    if (minIdx === maxIdx) {
      out.push(points[minIdx]!);
    } else if (minIdx < maxIdx) {
      out.push(points[minIdx]!, points[maxIdx]!);
    } else {
      out.push(points[maxIdx]!, points[minIdx]!);
    }
    i = end + 1;
  }
  if (out[out.length - 1] !== points[points.length - 1]) {
    out.push(points[points.length - 1]!);
  }
  return out;
}
