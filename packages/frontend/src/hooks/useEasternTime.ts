import { createSignal, onCleanup, onMount } from 'solid-js';

const etFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/**
 * Format a timestamp as HH:MM in Eastern Time (America/New_York).
 * Uses Intl.DateTimeFormat for automatic DST handling.
 */
export function formatEasternTime(timestampMs: number): string {
  return etFormatter.format(new Date(timestampMs));
}

/**
 * Hook that returns the current time in Eastern Time, updating every `intervalMs`.
 */
export function useEasternTime(intervalMs = 30_000): () => string {
  const [etTime, setEtTime] = createSignal(formatEasternTime(Date.now()));

  onMount(() => {
    const id = setInterval(() => setEtTime(formatEasternTime(Date.now())), intervalMs);
    onCleanup(() => clearInterval(id));
  });

  return etTime;
}
