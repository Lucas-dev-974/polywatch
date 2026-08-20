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

/** Facteur d'écart pour détecter une lacune : on casse le tracé quand l'écart
 * temporel entre deux points consécutifs dépasse 1.5× l'intervalle médian
 * (soit ~un tick manquant). */
const GAP_FACTOR = 1.5;
const GAP_FLOOR_MS = 60_000;

/** Trace le `d` de la courbe d'une série pour une row donnée.
 * `maxTicks` limite le tracé aux N derniers ticks (par ordre temporel).
 * Si `cutGaps` est vrai, les lacunes de données (point sans prix, ou tick
 * absent) coupent le tracé : les segments de part et d'autre ne sont pas reliés.
 * `clipUntilT` (si non-null) ne trace que les points dont t <= clipUntilT :
 * utilisé par le player de replay pour révéler les courbes progressivement. */
export function buildPath(
  series: BacktestMarketSeriesDto,
  voieTop: number,
  scale: RidgeScale,
  maxTicks?: number | null,
  cutGaps = true,
  clipUntilT?: number | null,
): string {
  const points = maxTicks && maxTicks > 0 ? series.points.slice(-maxTicks) : series.points;
  if (points.length === 0) return '';

  // Points valides (avec prix), conservés dans l'ordre temporel.
  const valid: { px: number; py: number; t: number }[] = [];
  for (const p of points) {
    if (p.yesPrice == null) continue;
    const t = Date.parse(p.t);
    if (clipUntilT != null && t > clipUntilT) continue;
    valid.push({ px: scale.xPos(t), py: scale.yPos(p.yesPrice, voieTop), t });
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

  // Construit le path en cassant la ligne dès qu'une lacune est détectée.
  const segments: string[] = [];
  for (let i = 0; i < valid.length; i++) {
    const p = valid[i];
    if (i === 0 || p.t - valid[i - 1].t > gapThreshold) {
      segments.push(`M${p.px.toFixed(1)},${p.py.toFixed(1)}`);
    } else {
      segments.push(`L${p.px.toFixed(1)},${p.py.toFixed(1)}`);
    }
  }
  return segments.join(' ');
}
