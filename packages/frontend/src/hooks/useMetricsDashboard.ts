import { createSignal, onMount, onCleanup } from 'solid-js';
import { api } from '../api';

export interface DashboardData {
  positions: {
    open: number;
    openByMode: Record<string, number>;
    byStatus: Record<string, number>;
    illiquid: number;
  };
  exits: {
    sl: number;
    tp: number;
    trailing: number;
    preClose: Record<string, number>;
    killSwitch: number;
  };
  strategy: {
    evalDurationMs: { count: number; sum: number; buckets: Record<string, number> };
    evalPositions: number;
    spreadMean: number;
  };
  worker: {
    lastPushTimestamp: number;
  };
  circuitBreaker: Record<string, number>;
  clob: {
    fetchDurationMs: { count: number; sum: number };
    errors: Record<string, number>;
  };
  dataApi: {
    fetchDurationMs: { count: number; sum: number };
    errors: number;
  };
  ws: {
    reconnects: Record<string, number>;
  };
  redemption: {
    total: Record<string, number>;
    payoff: Record<string, number>;
  };
  snapshots: {
    created: Record<string, number>;
    count: number;
    purged: number;
  };
  api: {
    routeDurationMs: Record<string, { count: number; sum: number }>;
  };
  nodejs: Record<string, number>;
}

export function useMetricsDashboard() {
  const [data, setData] = createSignal<DashboardData | null>(null);
  const [error, setError] = createSignal<string | null>(null);

  async function fetchMetrics() {
    try {
      const result = await api<DashboardData>('/internal/metrics/dashboard');
      setData(result);
      setError(null);
    } catch {
      setError('Impossible de charger les metriques');
    }
  }

  onMount(() => {
    void fetchMetrics();
    const interval = setInterval(fetchMetrics, 10_000);
    onCleanup(() => clearInterval(interval));
  });

  return { data, error, refresh: fetchMetrics };
}
