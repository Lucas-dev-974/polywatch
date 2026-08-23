import { createEffect, onCleanup } from 'solid-js';
import type { Viewport } from '../usePanZoomViewport';
import { VOIE_H } from './scale';

/**
 * Focus smooth du viewport pendant la lecture du player.
 * - Horizontalement : le viewport suit le playhead par PALIERS (discret), pas à chaque frame.
 *   On recentre seulement quand le playhead sort d'une zone tampon (ex: tiers central).
 *   Cela évite de recalculer la projection à chaque frame (P1/P2).
 * - Verticalement : le conteneur scrollable défile pour garder la row active visible,
 *   également avec un effet lissé (lerp) — n'affecte pas la projection X.
 * L'animation s'arrête dès que la lecture s'arrête.
 */
export function useRidgePlayerFocus(params: {
  isPlaying: () => boolean;
  playheadT: () => number | null;
  viewport: () => Viewport;
  setViewport: (v: Viewport) => void;
  runFrom: number;
  runTo: number;
  activeVoieIndex: () => number | null;
  scrollEl: () => HTMLDivElement | undefined;
}) {
  const { isPlaying, playheadT, viewport, setViewport, runFrom, runTo, activeVoieIndex, scrollEl } = params;

  // Fenêtre de focus : 25% de la plage totale, bornée à 1 min minimum.
  const focusSpan = () => {
    const total = Math.max(1, runTo - runFrom);
    return Math.max(60_000, total * 0.25);
  };

  // Zone tampon horizontale : on ne recentre que si playhead sort du tiers central
  const BUFFER_RATIO = 1 / 3;

  let rafId: number | null = null;

  const stop = () => {
    if (rafId != null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  };

  const step = () => {
    const t = playheadT();
    if (t == null) {
      stop();
      return;
    }

    // Suivi horizontal DISCRET (paliers) — pas de lerp continu
    const span = focusSpan();
    const v = viewport();
    const currentCenter = (v.minT + v.maxT) / 2;
    const buffer = span * BUFFER_RATIO;
    const minAllowed = currentCenter - buffer;
    const maxAllowed = currentCenter + buffer;

    let newMinT = v.minT;
    let newMaxT = v.maxT;

    if (t < minAllowed) {
      // Playhead sort à gauche → recentrer sur playhead
      newMinT = t - span / 2;
      newMaxT = t + span / 2;
    } else if (t > maxAllowed) {
      // Playhead sort à droite → recentrer sur playhead
      newMinT = t - span / 2;
      newMaxT = t + span / 2;
    }
    // Sinon : playhead dans la zone tampon → ne PAS bouger le viewport

    if (newMinT !== v.minT || newMaxT !== v.maxT) {
      setViewport({ minT: newMinT, maxT: newMaxT });
    }

    // Suivi vertical : défilement lissé pour garder la row active visible
    const el = scrollEl();
    const idx = activeVoieIndex();
    if (el && idx != null) {
      const top = idx * VOIE_H;
      const clientH = el.clientHeight;
      const targetScroll = top - (clientH - VOIE_H) / 2;
      const current = el.scrollTop;
      el.scrollTop = current + (targetScroll - current) * 0.18;
    }

    rafId = requestAnimationFrame(step);
  };

  createEffect(() => {
    if (isPlaying()) {
      stop();
      rafId = requestAnimationFrame(step);
    } else {
      stop();
    }
  });

  onCleanup(stop);
}
