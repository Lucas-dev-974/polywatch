import { createEffect, createSignal } from 'solid-js';

export interface Viewport {
  minT: number;
  maxT: number;
}

const MIN_SPAN_MS = 60_000;

/**
 * Gère la fenêtre temporelle (pan/zoom) d'un graphique.
 * - Pan illimité : on peut défiler librement au-delà de [runFrom, runTo] (les
 *   données n'occupent qu'une portion du viewport).
 * - Zoom borné : on ne peut ni zoomer au-delà de la plage totale, ni zoomer
 *   sous 1 minute.
 * - Réactif : si runFrom/runTo changent (ex. changement de fenêtre du ridge
 *   plot live), le viewport se réinitialise sur la nouvelle plage.
 */
export function usePanZoomViewport(runFrom: number, runTo: number) {
  const totalSpan = () => Math.max(1, runTo - runFrom);
  const [viewport, setViewport] = createSignal<Viewport>({ minT: runFrom, maxT: runTo });

  createEffect(() => {
    setViewport({ minT: runFrom, maxT: runTo });
  });

  const clampSpan = (span: number) => Math.min(Math.max(span, MIN_SPAN_MS), totalSpan());

  const zoomAt = (cursorT: number, factor: number) => {
    const v = viewport();
    const span = v.maxT - v.minT;
    const newSpan = clampSpan(span * factor);
    const ratio = (cursorT - v.minT) / span;
    const newMinT = cursorT - ratio * newSpan;
    setViewport({ minT: newMinT, maxT: newMinT + newSpan });
  };

  const pan = (deltaT: number) => {
    const v = viewport();
    setViewport({ minT: v.minT + deltaT, maxT: v.maxT + deltaT });
  };

  const reset = () => {
    setViewport({ minT: runFrom, maxT: runTo });
  };

  return { viewport, zoomAt, pan, reset };
}
