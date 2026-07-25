import { createSignal } from 'solid-js';
import { api } from '../api';
import { loadAlgoMarkets } from './algoMarketsStore';

export interface AutoTrackRule {
  id: number;
  cryptoSymbol: string;
  interval: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export const [rules, setRules] = createSignal<AutoTrackRule[]>([]);
const [isLoading, setIsLoading] = createSignal(false);
const [error, setError] = createSignal<string | null>(null);

export async function loadAutoTrackRules(): Promise<void> {
  if (isLoading()) return;
  setIsLoading(true);
  setError(null);
  try {
    const list = await api<AutoTrackRule[]>('/algo-auto-track');
    setRules(list);
  } catch (e) {
    setError((e as Error).message);
  } finally {
    setIsLoading(false);
  }
}

export async function createAutoTrackRule(
  cryptoSymbol: string,
  interval: string,
): Promise<void> {
  setError(null);
  try {
    await api<AutoTrackRule>('/algo-auto-track', {
      method: 'POST',
      body: JSON.stringify({ cryptoSymbol, interval }),
    });
    await loadAutoTrackRules();
    await loadAlgoMarkets();
  } catch (e) {
    setError((e as Error).message);
    throw e;
  }
}

export async function deleteAutoTrackRule(id: number): Promise<void> {
  setError(null);
  try {
    await api(`/algo-auto-track/${id}`, { method: 'DELETE' });
    await loadAutoTrackRules();
  } catch (e) {
    setError((e as Error).message);
  }
}

export async function setAutoTrackRuleEnabled(
  id: number,
  enabled: boolean,
): Promise<void> {
  setError(null);
  try {
    await api(`/algo-auto-track/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled }),
    });
    await loadAutoTrackRules();
    await loadAlgoMarkets();
  } catch (e) {
    setError((e as Error).message);
  }
}

export function useAutoTrackStore() {
  return {
    rules,
    isLoading,
    error,
    load: loadAutoTrackRules,
    create: createAutoTrackRule,
    delete: deleteAutoTrackRule,
    setEnabled: setAutoTrackRuleEnabled,
  };
}
