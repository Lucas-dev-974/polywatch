import { createSignal, onMount } from 'solid-js';
import { api } from '../api';
import type {
  AlgoSurveillanceSnapshot,
  SurveillanceHistoryResponse,
} from '../lib/algo-surveillance';

export const SURVEILLANCE_HISTORY_PAGE_SIZE = 20;

export function useCryptoAlgoSurveillance() {
  const [items, setItems] = createSignal<AlgoSurveillanceSnapshot[]>([]);
  const [total, setTotal] = createSignal(0);
  const [page, setPage] = createSignal(0);

  const pageCount = () =>
    Math.max(1, Math.ceil(total() / SURVEILLANCE_HISTORY_PAGE_SIZE));

  async function load(pageIndex: number) {
    const params = new URLSearchParams();
    params.set('limit', String(SURVEILLANCE_HISTORY_PAGE_SIZE));
    params.set('offset', String(pageIndex * SURVEILLANCE_HISTORY_PAGE_SIZE));
    try {
      const data = await api<SurveillanceHistoryResponse>(
        `/algo/surveillance-history?${params.toString()}`,
      );
      setItems(data.items);
      setTotal(data.total);
    } catch {
      setItems([]);
      setTotal(0);
    }
  }

  function refresh() {
    void load(page());
  }

  function goToPage(nextPage: number) {
    const maxPage = Math.max(
      0,
      Math.ceil(total() / SURVEILLANCE_HISTORY_PAGE_SIZE) - 1,
    );
    const clamped = Math.max(0, Math.min(nextPage, maxPage));
    setPage(clamped);
    void load(clamped);
  }

  onMount(() => {
    void load(0);
  });

  return {
    items,
    total,
    page,
    pageCount,
    goToPage,
    refresh,
  };
}
