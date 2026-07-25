import { createSignal, onMount, onCleanup } from 'solid-js';
import { api } from '../api';
import type { SystemOverviewResponse } from '../lib/system-overview';

const POLL_MS = 10_000;
const TIMEOUT_MS = 15_000;

export function useSystemOverview() {
  const [data, setData] = createSignal<SystemOverviewResponse | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [loading, setLoading] = createSignal(true);

  async function fetchOverview() {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const result = await api<SystemOverviewResponse>('/system/overview', {
        signal: controller.signal,
      });
      setData(result);
      setError(null);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setError('Le backend ne répond pas — vérifier que le serveur est en marche');
      } else {
        setError('Impossible de charger l\'aperçu système');
      }
    } finally {
      clearTimeout(timeoutId);
      setLoading(false);
    }
  }

  onMount(() => {
    void fetchOverview();
    const interval = setInterval(() => void fetchOverview(), POLL_MS);
    onCleanup(() => clearInterval(interval));
  });

  return { data, error, loading, refresh: fetchOverview };
}
