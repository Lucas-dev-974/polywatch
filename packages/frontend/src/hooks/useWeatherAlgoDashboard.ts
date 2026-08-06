import { createSignal, onCleanup, onMount } from 'solid-js';
import {
  api,
  apiText,
  fetchGlobalConfig,
  fetchWeatherConfig,
  updateGlobalConfig,
} from '../api';
import { onGlobalRefresh } from '../socket';
import { fetchWeatherAlgoCapital, type WeatherAlgoCapital } from '../lib/weather-algo-capital';

export interface WeatherStatus {
  alive: boolean;
  lastSeenAt: string | null;
  enabledSelections: number;
  selectionsWithMarket: number;
  watchedCities?: number;
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

export interface DiscoverDateBucket {
  date: string;
  dateLabel: string;
  markets: DiscoverMarket[];
  forecastMean: number | null;
  forecastStdDev: number | null;
  forecastStatus: 'fresh' | 'stale' | 'unavailable';
}

export interface CityMarketGroup {
  city: string;
  cityLabel: string;
  dates: DiscoverDateBucket[];
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
  mode: 'city_follow' | string | null;
}

const STATUS_POLL_MS = 10_000;

export function useWeatherAlgoDashboard() {
  const [status, setStatus] = createSignal<WeatherStatus | null>(null);
  const [discoverGroups, setDiscoverGroups] = createSignal<CityMarketGroup[]>([]);
  const [discoverLoading, setDiscoverLoading] = createSignal(false);
  const [autoTrackRules, setAutoTrackRules] = createSignal<AutoTrackRule[]>([]);
  const [capital, setCapital] = createSignal<WeatherAlgoCapital | null>(null);
  const [realTradingEnabled, setRealTradingEnabled] = createSignal(false);
  const [weatherAlgoSimEnabled, setWeatherAlgoSimEnabled] = createSignal(true);
  const [weatherAlgoRealEnabled, setWeatherAlgoRealEnabled] = createSignal(false);

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

  async function loadCapital() {
    try {
      setCapital(await fetchWeatherAlgoCapital());
    } catch {
      setCapital(null);
    }
  }

  async function loadRiskFlags() {
    try {
      const [global, weather] = await Promise.all([fetchGlobalConfig(), fetchWeatherConfig()]);
      setRealTradingEnabled(global.realTradingEnabled);
      setWeatherAlgoSimEnabled(weather.weatherAlgoSimEnabled);
      setWeatherAlgoRealEnabled(weather.weatherAlgoRealEnabled);
    } catch {
      setRealTradingEnabled(false);
      setWeatherAlgoSimEnabled(true);
      setWeatherAlgoRealEnabled(false);
    }
  }

  async function toggleRealTrading() {
    const next = !realTradingEnabled();
    if (
      next &&
      !confirm(
        'Activer le trading réel global ? Les algos configurés en mode réel exécuteront des ordres avec de vrais fonds.',
      )
    ) {
      return;
    }
    try {
      await updateGlobalConfig({ realTradingEnabled: next });
      setRealTradingEnabled(next);
    } catch (err) {
      alert(
        err instanceof Error
          ? `Échec : ${err.message}`
          : 'Impossible de modifier le trading réel.',
      );
    }
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

  async function watchCity(city: string, lookAheadDays: number = 1) {
    await api('/weather-algo-auto-track', {
      method: 'POST',
      body: JSON.stringify({ city, lookAheadDays }),
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

  async function updateAutoTrackLookAhead(id: number, lookAheadDays: number) {
    await api(`/weather-algo-auto-track/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ lookAheadDays }),
    });
    await refreshAutoTrackRules();
  }

  async function updateAllAutoTrackLookAhead(lookAheadDays: number) {
    const rules = autoTrackRules();
    if (rules.length === 0) return;
    await Promise.all(
      rules.map((r) =>
        api(`/weather-algo-auto-track/${r.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ lookAheadDays }),
        }),
      ),
    );
    await refreshAutoTrackRules();
  }

  function watchedCitySet(): Set<string> {
    return new Set(
      autoTrackRules().map((r) => r.city.trim().toLowerCase()),
    );
  }

  onMount(() => {
    void refreshStatus();
    void discoverMarkets();
    void refreshAutoTrackRules();
    void loadCapital();
    void loadRiskFlags();

    const poll = setInterval(() => {
      void refreshStatus();
      void loadCapital();
    }, STATUS_POLL_MS);

    const unsub = onGlobalRefresh(() => {
      void refreshStatus();
      void loadCapital();
      void loadRiskFlags();
    });

    onCleanup(() => {
      clearInterval(poll);
      unsub();
    });
  });

  return {
    status, discoverGroups, discoverLoading, autoTrackRules,
    discoverMarkets,
    watchCity, watchedCitySet, removeAutoTrackRule, toggleAutoTrackRule,
    updateAutoTrackLookAhead, updateAllAutoTrackLookAhead,
    refreshStatus, refreshAutoTrackRules,
    capital, realTradingEnabled, weatherAlgoSimEnabled, weatherAlgoRealEnabled,
    loadCapital, loadRiskFlags, toggleRealTrading,
  };
}