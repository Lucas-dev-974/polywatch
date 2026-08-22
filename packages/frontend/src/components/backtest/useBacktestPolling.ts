import { onCleanup } from 'solid-js';

const POLL_MS = 1000;

/**
 * Encapsule le polling d'un backtest : un timer qui appelle `onTick` à
 * intervalle régulier, avec start/stop explicites et arrêt automatique au
 * démontage du composant. Le polling se met en pause quand l'onglet est
 * inactif (document.visibilityState !== 'visible').
 */
export function useBacktestPolling(
  onTick: () => void,
  isActive: () => boolean = () => true,
) {
  let timer: ReturnType<typeof setInterval> | null = null;

  function isPaused() {
    return !isActive() || document.visibilityState !== 'visible';
  }

  function tick() {
    if (isPaused()) return;
    onTick();
  }

  function onVisibilityChange() {
    if (document.visibilityState !== 'visible') return;
    tick();
  }

  function start() {
    stop();
    timer = setInterval(tick, POLL_MS);
    document.addEventListener('visibilitychange', onVisibilityChange);
  }

  function stop() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    document.removeEventListener('visibilitychange', onVisibilityChange);
  }

  onCleanup(stop);

  return { start, stop };
}
