import { createSignal, onMount } from 'solid-js';
import { api } from '../api';
import type { EnvSettings } from '../components/env-settings-types';

/**
 * Loads the configured `maxSlippagePercent` (global entry slippage guard) so
 * the market chart signal marker tooltip can display "acceptable ≤ X%".
 * Uses the shared API cache (15s TTL for /risk-config).
 */
export function useMaxSlippagePercent() {
  const [maxSlippagePercent, setMaxSlippagePercent] = createSignal<number | null>(null);

  onMount(() => {
    void api<Pick<EnvSettings, 'maxSlippagePercent'>>('/risk-config')
      .then((cfg) => setMaxSlippagePercent(cfg.maxSlippagePercent ?? null))
      .catch(() => setMaxSlippagePercent(null));
  });

  return maxSlippagePercent;
}