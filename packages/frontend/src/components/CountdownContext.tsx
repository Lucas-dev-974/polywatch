import {
  createContext,
  createSignal,
  onCleanup,
  onMount,
  useContext,
  type JSX,
} from 'solid-js';

interface CountdownContextValue {
  now: () => number;
}

const CountdownContext = createContext<CountdownContextValue>({
  now: () => Date.now(),
});

const TICK_MS = 250;

/**
 * Provides a shared, reasonably accurate "now" signal for countdown timers.
 *
 * Browsers throttle setInterval in background tabs, which causes visible
 * jumps of several seconds. We mitigate this by:
 *   - syncing the first tick to the next wall-clock second,
 *   - correcting drift on every tick,
 *   - forcing an update when the tab becomes visible again.
 */
export function CountdownProvider(props: { children: JSX.Element }) {
  const [now, setNow] = createSignal(Date.now());

  onMount(() => {
    let expected = Date.now();

    const tick = () => {
      expected += TICK_MS;
      const drift = Date.now() - expected;
      setNow(Date.now());

      // Schedule the next tick, correcting for drift so errors don't accumulate.
      const nextDelay = Math.max(0, TICK_MS - drift);
      timer = setTimeout(tick, nextDelay);
    };

    let timer: ReturnType<typeof setTimeout> | null = null;

    const syncStart = () => {
      const msToNextTick = TICK_MS - (Date.now() % TICK_MS);
      expected = Date.now() + msToNextTick - TICK_MS;
      timer = setTimeout(() => {
        expected += TICK_MS;
        setNow(Date.now());
        tick();
      }, msToNextTick);
    };

    const handleVisibility = () => {
      if (document.hidden) return;
      // The tab just came back to the foreground; realign immediately.
      if (timer) {
        clearTimeout(timer);
      }
      syncStart();
    };

    syncStart();
    document.addEventListener('visibilitychange', handleVisibility);

    onCleanup(() => {
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', handleVisibility);
    });
  });

  return (
    <CountdownContext.Provider value={{ now }}>
      {props.children}
    </CountdownContext.Provider>
  );
}

export function useCountdownNow(): () => number {
  return useContext(CountdownContext).now;
}
