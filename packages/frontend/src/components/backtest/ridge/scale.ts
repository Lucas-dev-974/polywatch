import type { RidgeScale } from './types';

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
