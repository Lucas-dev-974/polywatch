import type { WeatherTimelineSeriesPoint } from '../weather-timeline-types';
import type { ChartPoint } from './types';

/**
 * Convertit une série (avec éventuels trous y null) en segments continus de points.
 *
 * Un segment est coupé dans deux cas :
 * 1. un point a `y == null` (trou explicite) ;
 * 2. l'écart temporel entre deux points consécutifs dépasse un seuil (trou
 *    implicite : des ticks manquants, ex. enregistrement interrompu). Sans
 *    cette coupure, le graph relierait le dernier point avant le trou au
 *    premier point après le trou par une ligne droite trompeuse.
 */
export function splitSegments(series: WeatherTimelineSeriesPoint[]): ChartPoint[][] {
  const segments: ChartPoint[][] = [];
  let current: ChartPoint[] = [];

  // Seuil de coupure : 3× l'écart médian entre points consécutifs valides.
  // Si la série est trop courte pour calculer un écart, on ne coupe pas.
  const gaps: number[] = [];
  for (let i = 1; i < series.length; i++) {
    const a = series[i - 1]!;
    const b = series[i]!;
    if (a.y != null && b.y != null) gaps.push(b.t - a.t);
  }
  gaps.sort((a, b) => a - b);
  const medianGap = gaps.length > 0 ? gaps[Math.floor(gaps.length / 2)]! : 0;
  const gapThreshold = medianGap > 0 ? medianGap * 3 : 0;

  for (let i = 0; i < series.length; i++) {
    const p = series[i]!;
    if (p.y == null) {
      if (current.length) segments.push(current);
      current = [];
      continue;
    }
    // Coupe si l'écart avec le point précédent dépasse le seuil.
    if (current.length > 0 && gapThreshold > 0) {
      const prev = current[current.length - 1]!;
      if (p.t - prev.t > gapThreshold) {
        segments.push(current);
        current = [];
      }
    }
    current.push({ t: p.t, y: p.y });
  }
  if (current.length) segments.push(current);
  return segments;
}
