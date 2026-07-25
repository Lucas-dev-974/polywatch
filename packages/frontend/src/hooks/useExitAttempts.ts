import { createEffect, createSignal } from 'solid-js';
import {
  fetchExitAttempts,
  type ExitAttemptEvent,
} from '../lib/exit-attempts';

/**
 * Load exit-attempt journal for a position. Failures leave items empty
 * so the market chart dialog stays usable.
 */
export function useExitAttempts(copiedPositionId: () => number | null | undefined) {
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [items, setItems] = createSignal<ExitAttemptEvent[]>([]);

  async function reload(id: number) {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchExitAttempts(id);
      setItems(Array.isArray(data.items) ? data.items : []);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Impossible de charger les tentatives',
      );
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  createEffect(() => {
    const id = copiedPositionId();
    if (id == null || !Number.isFinite(id)) {
      setItems([]);
      setError(null);
      setLoading(false);
      return;
    }
    void reload(id);
  });

  return { loading, error, items, reload };
}
