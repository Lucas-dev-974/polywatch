import { createEffect, createSignal, onCleanup, onMount } from 'solid-js';
import { api } from '../api';
import type { Execution } from '../lib/execution';
import { connectSocket } from '../socket';

/**
 * Limit of recent ALGO_OPEN executions to load for a single conditionId.
 * Covers the visible chart window (signals are only displayed for the last
 * 5s of each tick, and the chart shows the recent tick history). A larger
 * limit avoids false "not executed" states when the pipeline is slow.
 */
const ALGO_OPEN_EXECUTIONS_LIMIT = 50;

interface ExecutionsResponse {
  items: Execution[];
  total: number;
}

/**
 * Loads recent ALGO_OPEN executions for a specific conditionId and keeps
 * them fresh via the `execution` socket event. Used by the market chart
 * dialog to color signal markers (executed / failed / pending).
 */
export function useAlgoOpenExecutionsForCondition(conditionId: () => string | null) {
  const [executions, setExecutions] = createSignal<Execution[]>([]);

  async function load() {
    const cid = conditionId();
    if (!cid) {
      setExecutions([]);
      return;
    }
    const params = new URLSearchParams();
    params.set('conditionId', cid);
    params.set('limit', String(ALGO_OPEN_EXECUTIONS_LIMIT));
    // Status left unfiltered so filled, failed and pending are all returned.
    try {
      const data = await api<ExecutionsResponse>(
        `/algo/executions?${params.toString()}`,
      );
      // Defense in depth: backend already filters reason LIKE 'ALGO_%', but we
      // narrow to ALGO_OPEN client-side to avoid ALGO_INCREASE noise.
      setExecutions(data.items.filter((e) => e.reason === 'ALGO_OPEN'));
    } catch {
      setExecutions([]);
    }
  }

  onMount(() => {
    const socket = connectSocket();
    const onExecution = () => void load();
    socket.on('execution', onExecution);
    onCleanup(() => socket.off('execution', onExecution));
  });

  // Reload when the target conditionId changes.
  createEffect(() => {
    conditionId();
    void load();
  });

  return { executions, refresh: load };
}