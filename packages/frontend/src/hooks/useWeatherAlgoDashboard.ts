import { createSignal, onCleanup, onMount } from 'solid-js';
import { api, apiText } from '../api';
import { onGlobalRefresh } from '../socket';

export interface WeatherSelection {
  id: number;
  conditionId: string;
  question: string | null;
  eventSlug: string | null;
  city: string | null;
  targetDate: string | null;
  metric: string | null;
  targetValue: number | null;
  enabled: boolean;
}

export interface WeatherStatus {
  alive: boolean;
  lastSeenAt: string | null;
  enabledSelections: number;
  selectionsWithMarket: number;
  evaluableSelections: number;
  wsConnected: boolean | null;
  lastEvaluatedAt: string | null;
  lastSkipReason: string | null;
  lastSkipAt: string | null;
}

export interface DiscoverMarket {
  conditionId: string;
  question: string | null;
  eventSlug: string | null;
  tokenIdYes: string | null;
  tokenIdNo: string | null;
  outcomePrices: Array<{ outcome: string; price: number }>;
  endDate: string | null;
  parsed: boolean;
}

export interface CityMarketGroup {
  city: string;
  markets: DiscoverMarket[];
  /** ISO target date for the forecast (YYYY-MM-DD). */
  targetDate: string;
  /** Forecast mean temperature in °C. Null if unavailable. */
  forecastMean: number | null;
  /** Forecast standard deviation in °C. Null if unavailable. */
  forecastStdDev: number | null;
  /** fresh = from cache or live fetch; stale = expired cache; unavailable = no data. */
  forecastStatus: 'fresh' | 'stale' | 'unavailable';
}

export interface DiscoverResult {
  temperatureMarkets: DiscoverMarket[];
  allWeatherMarkets: DiscoverMarket[];
  byCity: CityMarketGroup[];
}

export interface AutoTrackRule {
  id: number;
  city: string;
  metric: string;
  lookAheadDays: number;
  enabled: boolean;
  mode: 'expand' | 'city_follow' | null;
}

const STATUS_POLL_MS = 10_000;

export function useWeatherAlgoDashboard() {
  const [selections, setSelections] = createSignal<WeatherSelection[]>([]);
  const [status, setStatus] = createSignal<WeatherStatus | null>(null);
  const [discoverGroups, setDiscoverGroups] = createSignal<CityMarketGroup[]>([]);
  const [discoverLoading, setDiscoverLoading] = createSignal(false);
  const [autoTrackRules, setAutoTrackRules] = createSignal<AutoTrackRule[]>([]);

  async function refreshSelections() {
    try {
      setSelections(await api<WeatherSelection[]>('/weather-algo-markets'));
    } catch { /* ignore */ }
  }

  async function refreshStatus() {
    try {
      setStatus(await api<WeatherStatus>('/weather-algo-markets/status'));
    } catch { /* ignore */ }
  }

  async function refreshAutoTrackRules() {
    try {
      setAutoTrackRules(await api<AutoTrackRule[]>('/weather-algo-auto-track'));
    } catch { /* ignore */ }
  }

  async function discoverMarkets() {
    setDiscoverLoading(true);
    setDiscoverGroups([]);
    try {
      const data = await api<DiscoverResult>('/weather-algo-discover?limit=50');
      setDiscoverGroups(data.byCity ?? []);
    } catch (err) {
      console.error('[WeatherAlgo] discoverMarkets failed:', err);
    } finally {
      setDiscoverLoading(false);
    }
  }

  async function addMarket(conditionId: string, question: string, eventSlug: string | null) {
    await api('/weather-algo-markets', {
      method: 'POST',
      body: JSON.stringify({ conditionId, question, eventSlug }),
    });
    await refreshSelections();
  }

  async function toggleSelection(conditionId: string, enabled: boolean) {
    await api(`/weather-algo-markets/${conditionId}`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled }),
    });
    await refreshSelections();
  }

  async function removeSelection(conditionId: string) {
    await apiText(`/weather-algo-markets/${conditionId}`, { method: 'DELETE' });
    await refreshSelections();
  }

  async function addAutoTrackRule(city: string, metric: string, lookAheadDays: number, mode?: 'expand' | 'city_follow') {
    await api('/weather-algo-auto-track', {
      method: 'POST',
      body: JSON.stringify({ city, metric, lookAheadDays, mode }),
    });
    await refreshAutoTrackRules();
  }

  async function removeAutoTrackRule(id: number) {
    await apiText(`/weather-algo-auto-track/${id}`, { method: 'DELETE' });
    await refreshAutoTrackRules();
  }

  async function toggleAutoTrackRule(id: number, enabled: boolean) {
    await api(`/weather-algo-auto-track/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled }),
    });
    await refreshAutoTrackRules();
  }

  onMount(() => {
    void refreshSelections();
    void refreshStatus();
    void discoverMarkets();
    void refreshAutoTrackRules();

    const poll = setInterval(() => {
      void refreshSelections();
      void refreshStatus();
    }, STATUS_POLL_MS);

    const unsub = onGlobalRefresh(() => {
      void refreshSelections();
      void refreshStatus();
    });

    onCleanup(() => {
      clearInterval(poll);
      unsub();
    });
  });

  return {
    selections, status, discoverGroups, discoverLoading, autoTrackRules,
    discoverMarkets, addMarket, toggleSelection, removeSelection,
    addAutoTrackRule, removeAutoTrackRule, toggleAutoTrackRule,
    refreshSelections, refreshStatus,
  };
}