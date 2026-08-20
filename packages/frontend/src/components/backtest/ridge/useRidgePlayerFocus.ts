import { createEffect, onCleanup } from 'solid-js';
import type { Viewport } from '../usePanZoomViewport';
import { VOIE_H } from './scale';

/**
 * Focus smooth du viewport pendant la lecture du player. Quand le player joue :
 * - Horizontalement : le viewport suit le playhead en restant centré sur lui,
 *   avec un effet de lissage (lerp) par frame.
 * - Verticalement : le conteneur scrollable défile pour garder la row active
 *   (celle contenant le playhead) visible, également avec un effet lissé.
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

    // Suivi horizontal (lerp).
    const span = focusSpan();
    const targetMin = t - span / 2;
    const targetMax = t + span / 2;
    const v = viewport();
    const k = 0.18;
    const minT = v.minT + (targetMin - v.minT) * k;
    const maxT = v.maxT + (targetMax - v.maxT) * k;
    setViewport({ minT, maxT });

    // Suivi vertical : défiler pour garder la row active visible.
    const el = scrollEl();
    const idx = activeVoieIndex();
    if (el && idx != null) {
      const top = idx * VOIE_H;
      const clientH = el.clientHeight;
      const targetScroll = top - (clientH - VOIE_H) / 2;
      const current = el.scrollTop;
      el.scrollTop = current + (targetScroll - current) * k;
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
