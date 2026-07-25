import { createSignal, onCleanup, onMount } from 'solid-js';
import {
  fetchAlgoWorkerQueueStatus,
  type AlgoWorkerQueueStatus,
} from '../lib/algo-worker-queue-status';

const POLL_MS = 10_000;

export function useAlgoWorkerQueueStatus() {
  const [status, setStatus] = createSignal<AlgoWorkerQueueStatus | null>(null);
  const [loading, setLoading] = createSignal(true);

  async function refresh() {
    try {
      setStatus(await fetchAlgoWorkerQueueStatus());
    } catch {
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }

  onMount(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), POLL_MS);
    onCleanup(() => clearInterval(timer));
  });

  return { status, loading, refresh };
}
