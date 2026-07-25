import { createSignal, onMount } from 'solid-js';
import { api } from '../api';
import type { Position } from '../lib/position';
import { filterPositionsByMode } from '../lib/algo-market-filters';

export type PosModeFilter = 'all' | 'sim' | 'real';

export function useCryptoAlgoPositions() {
  const [positions, setPositions] = createSignal<Position[]>([]);
  const [loadingPositions, setLoadingPositions] = createSignal(false);
  const [posTab, setPosTab] = createSignal<'open' | 'history'>('open');
  const [posModeFilter, setPosModeFilter] = createSignal<PosModeFilter>('all');

  const openPositions = () =>
    filterPositionsByMode(positions(), 'open', posModeFilter());

  const closedPositions = () =>
    filterPositionsByMode(positions(), 'closed', posModeFilter());

  async function refresh() {
    setLoadingPositions(true);
    try {
      const list = await api<Position[]>('/copied-positions?reason=algo');
      setPositions(list);
    } catch {
      setPositions([]);
    } finally {
      setLoadingPositions(false);
    }
  }

  onMount(() => {
    void refresh();
  });

  return {
    positions,
    loadingPositions,
    posTab,
    setPosTab,
    posModeFilter,
    setPosModeFilter,
    openPositions,
    closedPositions,
    refresh,
  };
}
