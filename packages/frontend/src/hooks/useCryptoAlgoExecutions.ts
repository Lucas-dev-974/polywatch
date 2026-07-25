import { createSignal, onCleanup, onMount } from 'solid-js';
import { api } from '../api';
import type { Execution } from '../lib/execution';
import { connectSocket } from '../socket';

export const CRYPTO_ALGO_EXECUTIONS_PAGE_SIZE = 20;

export type ExecModeFilter = 'all' | 'sim' | 'real';
export type ExecStatusFilter = 'all' | 'filled' | 'failed' | 'pending';

interface ExecutionsResponse {
  items: Execution[];
  total: number;
}

export function useCryptoAlgoExecutions() {
  const [executions, setExecutions] = createSignal<Execution[]>([]);
  const [total, setTotal] = createSignal(0);
  const [page, setPage] = createSignal(0);
  const [modeFilter, setModeFilterState] = createSignal<ExecModeFilter>('all');
  const [statusFilter, setStatusFilterState] = createSignal<ExecStatusFilter>('all');

  const pageCount = () =>
    Math.max(1, Math.ceil(total() / CRYPTO_ALGO_EXECUTIONS_PAGE_SIZE));

  async function load(pageIndex: number) {
    const params = new URLSearchParams();
    params.set('limit', String(CRYPTO_ALGO_EXECUTIONS_PAGE_SIZE));
    params.set('offset', String(pageIndex * CRYPTO_ALGO_EXECUTIONS_PAGE_SIZE));

    const mode = modeFilter();
    if (mode !== 'all') {
      params.set('mode', mode);
    }

    const status = statusFilter();
    if (status === 'filled' || status === 'failed') {
      params.set('status', status);
    } else if (status === 'pending') {
      params.set('statusGroup', 'pending');
    }

    try {
      const data = await api<ExecutionsResponse>(`/algo/executions?${params.toString()}`);
      setExecutions(data.items);
      setTotal(data.total);
    } catch {
      setExecutions([]);
      setTotal(0);
    }
  }

  function goToPage(nextPage: number) {
    const maxPage = Math.max(0, Math.ceil(total() / CRYPTO_ALGO_EXECUTIONS_PAGE_SIZE) - 1);
    const clamped = Math.max(0, Math.min(nextPage, maxPage));
    setPage(clamped);
    void load(clamped);
  }

  function setModeFilter(filter: ExecModeFilter) {
    setModeFilterState(filter);
    setPage(0);
    void load(0);
  }

  function setStatusFilter(filter: ExecStatusFilter) {
    setStatusFilterState(filter);
    setPage(0);
    void load(0);
  }

  function refresh() {
    void load(page());
  }

  onMount(() => {
    void load(0);
    const socket = connectSocket();
    const onExecution = () => refresh();
    socket.on('execution', onExecution);
    onCleanup(() => socket.off('execution', onExecution));
  });

  return {
    executions,
    total,
    page,
    pageCount,
    goToPage,
    modeFilter,
    setModeFilter,
    statusFilter,
    setStatusFilter,
    refresh,
  };
}
