import { onCleanup } from 'solid-js';

const POLL_MS = 1000;

/**
 * Encapsule le polling d'un backtest : un timer qui appelle `onTick` à
 * intervalle régulier, avec start/stop explicites et arrêt automatique au
 * démontage du composant. Le polling se met en pause quand l'onglet est
 * inactif (document.visibilityState !== 'visible').
 *
 * Garanties anti-réentrance : si `onTick` est encore en cours d'exécution
 * quand le prochain tick arrive, on le saute (pas de chevauchement). `onTick`
 * peut retourner une promesse ; tant qu'elle n'est pas résolue, aucun tick
 * suivant n'est émis.
 */
export function useBacktestPolling(
  onTick: () => void | Promise<void>,
  isActive: () => boolean = () => true,
  pollMs = POLL_MS,
) {
  let timer: ReturnType<typeof setInterval> | null = null;
  let inFlight = false;

  function isPaused() {
    return !isActive() || document.visibilityState !== 'visible';
  }

  async function runTick() {
    if (inFlight || isPaused()) return;
    inFlight = true;
    try {
      await onTick();
    } catch {
      /* un tick qui échoue ne doit pas arrêter le polling */
    } finally {
      inFlight = false;
    }
  }

  function tick() {
    void runTick();
  }

  function onVisibilityChange() {
    if (document.visibilityState !== 'visible') return;
    tick();
  }

  function start() {
    stop();
    timer = setInterval(tick, pollMs);
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
