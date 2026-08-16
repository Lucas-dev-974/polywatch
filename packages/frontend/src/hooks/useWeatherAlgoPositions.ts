import { createSignal, onCleanup, onMount } from 'solid-js';
import { api } from '../api';
import {
  UI_KEYS,
  WEATHER_ALGO_POS_MODE_FILTERS,
  WEATHER_ALGO_POS_TABS,
  usePersistedEnum,
  usePersistedSignal,
  type WeatherAlgoPosModeFilter,
  type WeatherAlgoPosTab,
} from '../lib/ui-persistence';
import { onGlobalRefresh } from '../socket';

export interface WeatherForecastSnapshot {
  city: string;
  targetDate: string;
  metric: string;
  unit: 'celsius' | 'fahrenheit' | null;
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

export type WeatherPosTab = WeatherAlgoPosTab;
export type WeatherPosModeFilter = WeatherAlgoPosModeFilter;

const POLL_MS = 10_000;
export const WEATHER_ALGO_POS_HISTORY_PAGE_SIZE = 20;

interface ClosedPositionsResponse {
  items: WeatherPosition[];
  total: number;
}

function isWeatherReason(reason: string | null | undefined): boolean {
  return reason != null && reason.startsWith('WEATHER_');
}

export function useWeatherAlgoPositions() {
  const [positions, setPositions] = createSignal<WeatherPosition[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [closedPositions, setClosedPositions] = createSignal<WeatherPosition[]>([]);
  const [loadingHistory, setLoadingHistory] = createSignal(false);
  const [historyLoaded, setHistoryLoaded] = createSignal(false);
  const [historyTotal, setHistoryTotal] = createSignal(0);
  const [historyPage, setHistoryPage] = usePersistedSignal(
    UI_KEYS.weatherAlgoPosHistoryPage,
    0,
    (value): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0,
  );
  const [posTab, setPosTab] = usePersistedEnum(
    UI_KEYS.weatherAlgoPosTab,
    'open',
    WEATHER_ALGO_POS_TABS,
  );
  const [posModeFilter, setPosModeFilter] = usePersistedEnum(
    UI_KEYS.weatherAlgoPosModeFilter,
    'all',
    WEATHER_ALGO_POS_MODE_FILTERS,
  );

  const historyPageCount = () =>
    Math.max(1, Math.ceil(historyTotal() / WEATHER_ALGO_POS_HISTORY_PAGE_SIZE));

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
      const params = new URLSearchParams();
      params.set('limit', String(WEATHER_ALGO_POS_HISTORY_PAGE_SIZE));
      params.set('offset', String(historyPage() * WEATHER_ALGO_POS_HISTORY_PAGE_SIZE));
      const data = await api<ClosedPositionsResponse>(
        `/copied-positions?status=closed&reason=weather&${params.toString()}`,
      );
      setClosedPositions(data.items.filter((p) => isWeatherReason(p.reason)));
      setHistoryTotal(data.total);
      setHistoryLoaded(true);
    } catch {
      setClosedPositions([]);
      setHistoryTotal(0);
    } finally {
      setLoadingHistory(false);
    }
  }

  function goToHistoryPage(nextPage: number) {
    const maxPage = Math.max(
      0,
      Math.ceil(historyTotal() / WEATHER_ALGO_POS_HISTORY_PAGE_SIZE) - 1,
    );
    const clamped = Math.max(0, Math.min(nextPage, maxPage));
    setHistoryPage(clamped);
    void refreshHistory();
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
    if (tab === 'history') {
      // Reset pagination when entering history tab to avoid stale page from previous session
      if (historyPage() !== 0) setHistoryPage(0);
      if (!historyLoaded() && !loadingHistory()) {
        void refreshHistory();
      }
    }
  }

  onMount(() => {
    void refresh();
    if (posTab() === 'history') {
      void refreshHistory();
    }
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
    historyTotal,
    historyPage,
    historyPageCount,
    goToHistoryPage,
    refreshHistory,
    posTab,
    selectPosTab,
    setPosTab,
    posModeFilter,
    setPosModeFilter,
  };
}