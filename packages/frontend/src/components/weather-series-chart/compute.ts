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
): WeatherTimelineBucketData[] {
  if (minPrice <= 0) return buckets;
  return buckets.filter((b) => {
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
