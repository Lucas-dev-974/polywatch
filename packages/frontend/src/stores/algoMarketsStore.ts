import { createSignal } from 'solid-js';
import { api } from '../api';

export interface AlgoMarketSelection {
  id: number;
  conditionId: string;
  question: string | null;
  cryptoSymbol: string | null;
  interval: string | null;
  slug: string | null;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface AlgoMarketStatus {
  alive: boolean;
  lastSeenAt: Date | null;
  enabledSelections: number;
  selectionsWithMarket: number;
  evaluableSelections: number;
  wsConnected: boolean | null;
  lastEvaluatedAt: Date | null;
  lastSkipReason: string | null;
  lastSkipAt: Date | null;
}

export interface AlgoMarketToggleItem {
  conditionId: string;
  question?: string | null;
  cryptoSymbol?: string | null;
  interval?: string | null;
  slug?: string | null;
}

export const [selections, setSelections] = createSignal<AlgoMarketSelection[]>([]);
export const [selectedConditionIds, setSelectedConditionIds] = createSignal<Set<string>>(
  new Set(),
);
const [isLoading, setIsLoading] = createSignal(false);
const [error, setError] = createSignal<string | null>(null);

export async function loadAlgoMarkets(): Promise<void> {
  if (isLoading()) return;
  setIsLoading(true);
  setError(null);
  try {
    const list = await api<AlgoMarketSelection[]>('/algo-markets');
    setSelections(list);
    setSelectedConditionIds(new Set(list.map((s) => s.conditionId)));
  } catch (e) {
    setError((e as Error).message);
  } finally {
    setIsLoading(false);
  }
}

export async function toggleAlgoMarket(item: AlgoMarketToggleItem): Promise<void> {
  const current = selectedConditionIds();
  if (current.has(item.conditionId)) {
    await removeAlgoMarket(item.conditionId);
    return;
  }
  try {
    await api<AlgoMarketSelection>('/algo-markets', {
      method: 'POST',
      body: JSON.stringify({
        conditionId: item.conditionId,
        question: item.question ?? undefined,
        cryptoSymbol: item.cryptoSymbol ?? undefined,
        interval: item.interval ?? undefined,
        slug: item.slug ?? undefined,
      }),
    });
    const next = new Set(selectedConditionIds());
    next.add(item.conditionId);
    setSelectedConditionIds(next);
    await loadAlgoMarkets();
  } catch (e) {
    setError((e as Error).message);
  }
}

export function isAlgoSelected(conditionId: string): boolean {
  return selectedConditionIds().has(conditionId);
}

export async function removeAlgoMarket(conditionId: string): Promise<void> {
  try {
    await api(`/algo-markets/${conditionId}`, { method: 'DELETE' });
    const next = new Set(selectedConditionIds());
    next.delete(conditionId);
    setSelectedConditionIds(next);
    await loadAlgoMarkets();
  } catch (e) {
    setError((e as Error).message);
  }
}

export async function setAlgoMarketEnabled(
  conditionId: string,
  enabled: boolean,
): Promise<void> {
  try {
    await api(`/algo-markets/${conditionId}`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled }),
    });
    await loadAlgoMarkets();
  } catch (e) {
    setError((e as Error).message);
  }
}

export async function loadStatus(): Promise<AlgoMarketStatus> {
  return api<AlgoMarketStatus>('/algo-markets/status');
}

export function useAlgoMarketsStore() {
  return {
    selections,
    selectedConditionIds,
    isLoading,
    error,
    load: loadAlgoMarkets,
    toggle: toggleAlgoMarket,
    isSelected: isAlgoSelected,
    remove: removeAlgoMarket,
    setEnabled: setAlgoMarketEnabled,
    loadStatus,
  };
}