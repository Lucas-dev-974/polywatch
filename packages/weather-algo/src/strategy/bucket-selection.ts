import type { WeatherSignal } from './strategy.js';

/**
 * Pick the bucket with the highest YES edge.
 * On exact edge ties, pick the bucket whose centre is closest to the forecast mean.
 */
export function pickBestEdgeBucket(
  candidates: WeatherSignal[],
  forecastMean: number,
): WeatherSignal {
  if (candidates.length === 0) {
    throw new Error('pickBestEdgeBucket called with empty candidates');
  }
  return candidates.reduce((best, current) => {
    if (current.edge > best.edge) return current;
    if (current.edge < best.edge) return best;
    const currentCentre = bucketCentre(current.entryBucketBounds, forecastMean);
    const bestCentre = bucketCentre(best.entryBucketBounds, forecastMean);
    const currentDist = Math.abs(forecastMean - currentCentre);
    const bestDist = Math.abs(forecastMean - bestCentre);
    return currentDist < bestDist ? current : best;
  });
}

export function bucketCentre(
  bounds: WeatherSignal['entryBucketBounds'],
  fallback: number,
): number {
  if (bounds?.target != null) return bounds.target;
  if (bounds?.low != null && bounds?.high != null) return (bounds.low + bounds.high) / 2;
  return fallback;
}
