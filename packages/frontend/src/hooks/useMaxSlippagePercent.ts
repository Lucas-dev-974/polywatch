import { createSignal, onMount } from 'solid-js';
import { fetchGlobalConfig } from '../api';
import type { EnvSettings } from '../components/settings/env-settings-types';

/**
 * Loads the configured `maxSlippagePercent` (global entry slippage guard) so
 * the market chart signal marker tooltip can display "acceptable ≤ X%".
 * Uses the shared API cache (15s TTL for /config/global).
 */
export function useMaxSlippagePercent() {
  const [maxSlippagePercent, setMaxSlippagePercent] = createSignal<number | null>(null);

  onMount(() => {
    void fetchGlobalConfig()
      .then((cfg: Pick<EnvSettings, 'maxSlippagePercent'>) =>
        setMaxSlippagePercent(cfg.maxSlippagePercent ?? null),
      )
      .catch(() => setMaxSlippagePercent(null));
  });

  return maxSlippagePercent;
}