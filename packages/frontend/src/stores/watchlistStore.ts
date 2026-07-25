import { createSignal } from 'solid-js';
import { api } from '../api';

export interface WatchlistEntry {
  id: number;
  traderAddress: string;
  nickname: string | null;
  active: boolean;
  simEnabled: boolean;
  realEnabled: boolean;
}

const [entries, setEntries] = createSignal<WatchlistEntry[]>([]);
const [loading, setLoading] = createSignal(false);
const [error, setError] = createSignal<string | null>(null);

export async function loadWatchlist(): Promise<void> {
  if (loading()) return;
  setLoading(true);
  setError(null);
  try {
    setEntries(await api<WatchlistEntry[]>('/watchlist'));
  } catch (e) {
    setError((e as Error).message);
  } finally {
    setLoading(false);
  }
}

export async function addToWatchlist(
  traderAddress: string,
  nickname?: string,
): Promise<void> {
  await api('/watchlist', {
    method: 'POST',
    body: JSON.stringify({ traderAddress, nickname: nickname || undefined }),
  });
  await loadWatchlist();
}

export async function removeFromWatchlist(id: number): Promise<void> {
  await api(`/watchlist/${id}`, { method: 'DELETE' });
  await loadWatchlist();
}

export async function patchWatchlistEntry(
  id: number,
  patch: Partial<Pick<WatchlistEntry, 'active' | 'simEnabled' | 'realEnabled'>>,
): Promise<void> {
  await api(`/watchlist/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
  await loadWatchlist();
}

export function useWatchlistStore() {
  return {
    entries,
    loading,
    error,
    load: loadWatchlist,
    add: addToWatchlist,
    remove: removeFromWatchlist,
    patch: patchWatchlistEntry,
  };
}
