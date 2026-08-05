import { createSignal, onCleanup, onMount } from 'solid-js';
import { api } from '../api';
import { onGlobalRefresh } from '../socket';

export interface WeatherForecastSnapshot {
  city: string;
  targetDate: string;
  metric: string;
  entryForecastMean: number;
  entryForecastStdDev: number;
  entryBucketComparison: string | null;
  entryBucketBounds: { low?: number; high?: number; target?: number } | null;
}

export interface WeatherPosition {
  id: number;
  conditionId: string;
  assetId: string;
  outcome: string;
  quantity: number;
  entryPrice: number;
  status: string;
  mode: string;
  unrealizedPnl: number;
  realizedPnl: number;
  reason: string | null;
  marketQuestion: string | null;
  marketUrl: string | null;
  closedAt: string | null;
  closeReason: string | null;
  openedAt: string | null;
  /** Filled BUY quantity (closed positions — quantity is 0 after exit). */
  entryQuantityFilled?: number | null;
  /** Total entry cost from BUY fills (closed positions only). */
  entryInvestedAmount?: number | null;
  /** Fill price of the last successful SELL execution (exit price). */
  exitBidVwap?: number | null;
  weatherForecast: WeatherForecastSnapshot | null;
}

export type WeatherPosTab = 'open' | 'history';
export type WeatherPosModeFilter = 'all' | 'live' | 'sim';

const POLL_MS = 10_000;

function isWeatherReason(reason: string | null | undefined): boolean {
  return reason != null && reason.startsWith('WEATHER_');
}

export function useWeatherAlgoPositions() {
  const [positions, setPositions] = createSignal<WeatherPosition[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [closedPositions, setClosedPositions] = createSignal<WeatherPosition[]>([]);
  const [loadingHistory, setLoadingHistory] = createSignal(false);
  const [historyLoaded, setHistoryLoaded] = createSignal(false);
  const [posTab, setPosTab] = createSignal<WeatherPosTab>('open');
  const [posModeFilter, setPosModeFilter] = createSignal<WeatherPosModeFilter>('all');

  async function refresh() {
    try {
      const data = await api<WeatherPosition[]>('/copied-positions?status=open&reason=weather');
      setPositions(data.filter((p) => isWeatherReason(p.reason)));
    } catch { /* ignore */ }
    setLoading(false);
  }

  async function refreshHistory() {
    setLoadingHistory(true);
    try {
      const data = await api<WeatherPosition[]>('/copied-positions?status=closed&reason=weather');
      setClosedPositions(data.filter((p) => isWeatherReason(p.reason)));
      setHistoryLoaded(true);
    } catch {
      setClosedPositions([]);
    } finally {
      setLoadingHistory(false);
    }
  }

  async function closePosition(id: number) {
    try {
      await api(`/copied-positions/${id}/close`, { method: 'POST' });
      await refresh();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Failed to close weather position', id, err);
      throw err;
    }
  }

  /** Switch tab, lazily loading closed-position history on first visit. */
  function selectPosTab(tab: WeatherPosTab) {
    setPosTab(tab);
    if (tab === 'history' && !historyLoaded() && !loadingHistory()) {
      void refreshHistory();
    }
  }

  onMount(() => {
    void refresh();
    const poll = setInterval(() => void refresh(), POLL_MS);
    // Refresh immediately on any simulation reset (payload-algoKind agnostic —
    // this hook already filters weather-only rows, a spurious refetch is cheap).
    const unsubscribeRefresh = onGlobalRefresh(() => {
      void refresh();
      if (historyLoaded()) void refreshHistory();
    });
    onCleanup(() => {
      clearInterval(poll);
      unsubscribeRefresh();
    });
  });

  return {
    positions,
    loading,
    closePosition,
    refresh,
    closedPositions,
    loadingHistory,
    historyLoaded,
    refreshHistory,
    posTab,
    selectPosTab,
    setPosTab,
    posModeFilter,
    setPosModeFilter,
  };
}