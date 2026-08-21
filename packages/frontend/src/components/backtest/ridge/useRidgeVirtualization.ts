import { createEffect, createMemo, createSignal } from 'solid-js';
import type { VisibleVoie, VoieGroup } from './types';
import { VOIE_H } from './scale';

// Nombre de voies rendues en plus de la fenêtre visible (haut et bas) pour
// éviter un flash au scroll.
const VOIE_OVERSCAN = 5;

/**
 * Virtualisation verticale du ridge plot. Le scroll vertical est natif
 * (`.backtest-ridge-scroll`) : on ne rend que les voies visibles (+ overscan)
 * pour supporter des centaines de voies sans dégrader le rendu.
 *
 * `visibleVoies` associe chaque voie visible à son index global (nécessaire
 * pour le positionnement `scale().top(globalIndex)` et la comparaison de
 * hover, l'index du `<For>` étant local au sous-ensemble rendu).
 */
export function useRidgeVirtualization(voies: () => VoieGroup[]) {
  const [scrollEl, setScrollEl] = createSignal<HTMLDivElement>();
  const [scrollTop, setScrollTop] = createSignal(0);
  const [scrollViewportH, setScrollViewportH] = createSignal(0);

  const visibleVoies = createMemo<VisibleVoie[]>(() => {
    const all = voies();
    if (all.length === 0) return [];
    const viewportH = scrollViewportH();
    if (viewportH <= 0) {
      // Pas encore mesuré : on rend tout (premier rendu) pour éviter un flash.
      return all.map((voie, i) => ({ voie, globalIndex: i }));
    }
    const top = scrollTop();
    const first = Math.max(0, Math.floor(top / VOIE_H) - VOIE_OVERSCAN);
    const last = Math.min(all.length - 1, Math.ceil((top + viewportH) / VOIE_H) + VOIE_OVERSCAN);
    const out: VisibleVoie[] = [];
    for (let i = first; i <= last; i++) out.push({ voie: all[i], globalIndex: i });
    return out;
  });

  const onScroll = (e: Event) => {
    const el = e.currentTarget as HTMLDivElement;
    setScrollTop(el.scrollTop);
    setScrollViewportH(el.clientHeight);
  };

  // Resynchronise la fenêtre de virtualisation quand la liste des voies change
  // (filtre date cible, nouvelles données live, etc.). Le navigateur clamp
  // `scrollTop` à la nouvelle hauteur de contenu sans déclencher `onScroll`,
  // donc on relit la valeur réellement appliquée par le DOM.
  createEffect(() => {
    voies(); // dépendance : se rejoue quand la liste change.
    const el = scrollEl();
    if (!el) return;
    const clamped = Math.min(el.scrollTop, Math.max(0, el.scrollHeight - el.clientHeight));
    setScrollTop(clamped);
    setScrollViewportH(el.clientHeight);
  });

  return { scrollEl, setScrollEl, visibleVoies, onScroll };
}
