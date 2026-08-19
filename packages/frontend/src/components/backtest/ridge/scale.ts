import type { BacktestMarketSeriesDto } from '../../../api';
import type { RidgeScale } from './types';

export const VOIE_H = 48;
export const MARGIN_TOP = 12;
export const Y_TICKS = [0, 0.5, 1];

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

/** Trace le `d` de la courbe d'une série pour une row donnée. */
export function buildPath(series: BacktestMarketSeriesDto, voieTop: number, scale: RidgeScale): string {
  const mapped = series.points
    .filter((p) => p.yesPrice != null)
    .map((p) => ({ px: scale.xPos(Date.parse(p.t)), py: scale.yPos(p.yesPrice!, voieTop) }));
  if (mapped.length === 0) return '';
  return mapped.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.px.toFixed(1)},${p.py.toFixed(1)}`).join(' ');
}
