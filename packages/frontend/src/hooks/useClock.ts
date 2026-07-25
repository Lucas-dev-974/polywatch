import { createSignal, onCleanup, onMount } from 'solid-js';

export function useClock(intervalMs = 30_000): () => number {
  const [now, setNow] = createSignal(Date.now());

  onMount(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    onCleanup(() => clearInterval(id));
  });

  return now;
}
