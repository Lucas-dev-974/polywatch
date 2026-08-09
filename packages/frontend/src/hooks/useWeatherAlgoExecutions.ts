import { createSignal, onCleanup, onMount } from 'solid-js';
import { api } from '../api';
import type { Execution } from '../lib/execution';
import {
  UI_KEYS,
  WEATHER_ALGO_EXEC_MODE_FILTERS,
  WEATHER_ALGO_EXEC_STATUS_FILTERS,
  usePersistedEnum,
  usePersistedSignal,
  type WeatherAlgoExecModeFilter,
  type WeatherAlgoExecStatusFilter,
} from '../lib/ui-persistence';
import type { WeatherForecastSnapshot } from './useWeatherAlgoPositions';
import { connectSocket } from '../socket';

export const WEATHER_ALGO_EXECUTIONS_PAGE_SIZE = 20;

export type WeatherExecModeFilter = WeatherAlgoExecModeFilter;
export type WeatherExecStatusFilter = WeatherAlgoExecStatusFilter;

export interface WeatherExecution extends Execution {
  marketUrl?: string | null;
  weatherForecast: WeatherForecastSnapshot | null;
}

interface ExecutionsResponse {
  items: WeatherExecution[];
  total: number;
}

export function useWeatherAlgoExecutions() {
  const [executions, setExecutions] = createSignal<WeatherExecution[]>([]);
  const [total, setTotal] = createSignal(0);
  const [page, setPage] = usePersistedSignal(
    UI_KEYS.weatherAlgoExecPage,
    0,
    (value): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0,
  );
  const [modeFilter, setModeFilterState] = usePersistedEnum(
    UI_KEYS.weatherAlgoExecModeFilter,
    'all',
    WEATHER_ALGO_EXEC_MODE_FILTERS,
  );
  const [statusFilter, setStatusFilterState] = usePersistedEnum(
    UI_KEYS.weatherAlgoExecStatusFilter,
    'all',
    WEATHER_ALGO_EXEC_STATUS_FILTERS,
  );
  const [loading, setLoading] = createSignal(true);

  const pageCount = () =>
    Math.max(1, Math.ceil(total() / WEATHER_ALGO_EXECUTIONS_PAGE_SIZE));

  async function load(pageIndex: number) {
    const params = new URLSearchParams();
    params.set('limit', String(WEATHER_ALGO_EXECUTIONS_PAGE_SIZE));
    params.set('offset', String(pageIndex * WEATHER_ALGO_EXECUTIONS_PAGE_SIZE));

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
      const data = await api<ExecutionsResponse>(`/weather-algo/executions?${params.toString()}`);
      setExecutions(data.items);
      setTotal(data.total);
    } catch {
      setExecutions([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }

  function goToPage(nextPage: number) {
    const maxPage = Math.max(0, Math.ceil(total() / WEATHER_ALGO_EXECUTIONS_PAGE_SIZE) - 1);
    const clamped = Math.max(0, Math.min(nextPage, maxPage));
    setPage(clamped);
    void load(clamped);
  }

  function setModeFilter(filter: WeatherExecModeFilter) {
    setModeFilterState(filter);
    setPage(0);
    setLoading(true);
    void load(0);
  }

  function setStatusFilter(filter: WeatherExecStatusFilter) {
    setStatusFilterState(filter);
    setPage(0);
    setLoading(true);
    void load(0);
  }

  function refresh() {
    void load(page());
  }

  onMount(() => {
    void load(page());
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
    loading,
    refresh,
  };
}