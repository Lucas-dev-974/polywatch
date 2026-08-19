import { onCleanup } from 'solid-js';

const POLL_MS = 4000;

/**
 * Encapsule le polling d'un backtest : un timer qui appelle `onTick` à
 * intervalle régulier, avec start/stop explicites et arrêt automatique au
 * démontage du composant.
 */
export function useBacktestPolling(onTick: () => void) {
  let timer: ReturnType<typeof setInterval> | null = null;

  function start() {
    stop();
    timer = setInterval(onTick, POLL_MS);
  }

  function stop() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  onCleanup(stop);

  return { start, stop };
}
