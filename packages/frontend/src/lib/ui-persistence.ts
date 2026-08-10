import { createEffect, createSignal, type Accessor, type Setter } from 'solid-js';

export type UiMode = 'sim' | 'real';

export type AppPage =
  | 'simulation'
  | 'real'
  | 'leaderboard'
  | 'markets'
  | 'wallet'
  | 'crypto-algo'
  | 'weather-algo'
  | 'system';
export const APP_PAGES = [
  'simulation',
  'real',
  'leaderboard',
  'markets',
  'wallet',
  'crypto-algo',
  'weather-algo',
  'system',
] as const;

export type SystemPageTab = 'overview' | 'reports' | 'snapshots' | 'e2e-tests' | 'metrics' | 'crypto-algo-monitor';
export const SYSTEM_PAGE_TABS = ['overview', 'reports', 'snapshots', 'e2e-tests', 'metrics', 'crypto-algo-monitor'] as const;

/** Anciennes valeurs de `polywatch_page` regroupées sous Système. */
export const LEGACY_SYSTEM_PAGES = [
  'overview',
  'reports',
  'snapshots',
  'e2e-tests',
  'metrics',
  'crypto-algo-monitor',
] as const;
export type LegacySystemPage = (typeof LEGACY_SYSTEM_PAGES)[number];

export function isLegacySystemPage(value: unknown): value is LegacySystemPage {
  return (
    typeof value === 'string' &&
    (LEGACY_SYSTEM_PAGES as readonly string[]).includes(value)
  );
}

export type SimPageTab = 'activity' | 'analytics';
export const SIM_PAGE_TABS = ['activity', 'analytics'] as const;

export type SnapshotsPageMode = 'sim' | 'real';
export const SNAPSHOTS_PAGE_MODES = ['sim', 'real'] as const;

export type WeatherAlgoPageTab =
  | 'markets'
  | 'positions'
  | 'cities'
  | 'data'
  | 'backtest'
  | 'strategies'
  | 'settings';
export const WEATHER_ALGO_PAGE_TABS = [
  'markets',
  'positions',
  'cities',
  'data',
  'backtest',
  'strategies',
  'settings',
] as const;

export type WeatherAlgoPosTab = 'open' | 'history';
export const WEATHER_ALGO_POS_TABS = ['open', 'history'] as const;

export type WeatherAlgoPosModeFilter = 'all' | 'live' | 'sim';
export const WEATHER_ALGO_POS_MODE_FILTERS = ['all', 'live', 'sim'] as const;

export type WeatherAlgoPosOpenSubTab = 'live' | 'sim';
export const WEATHER_ALGO_POS_OPEN_SUB_TABS = ['live', 'sim'] as const;

export type WeatherAlgoExecModeFilter = 'all' | 'sim' | 'real';
export const WEATHER_ALGO_EXEC_MODE_FILTERS = ['all', 'sim', 'real'] as const;

export type WeatherAlgoExecStatusFilter = 'all' | 'filled' | 'failed' | 'pending';
export const WEATHER_ALGO_EXEC_STATUS_FILTERS = [
  'all',
  'filled',
  'failed',
  'pending',
] as const;

export type WeatherAlgoDataView = 'grid' | 'detail';
export const WEATHER_ALGO_DATA_VIEWS = ['grid', 'detail'] as const;

export type WeatherAlgoDataDetailMode = 'list' | 'timeline';
export const WEATHER_ALGO_DATA_DETAIL_MODES = ['list', 'timeline'] as const;

export type WeatherAlgoDataTableId =
  | 'forecast_history'
  | 'market_snapshots'
  | 'bucket_ticks'
  | 'evaluation_log'
  | 'forecast_cache'
  | 'position_forecasts'
  | 'clob_price_history';
export const WEATHER_ALGO_DATA_TABLE_IDS = [
  'forecast_history',
  'market_snapshots',
  'bucket_ticks',
  'evaluation_log',
  'forecast_cache',
  'position_forecasts',
  'clob_price_history',
] as const;

export const WEATHER_ALGO_TIMELINE_MAX_TICKS = [500, 2000, 5000] as const;

export const POSITION_TABS = ['open', 'redemption', 'failed', 'history'] as const;

export const POSITION_LIST_LAYOUTS = ['flat', 'split'] as const;
export type PositionListLayout = (typeof POSITION_LIST_LAYOUTS)[number];

export type CollapsedSection = 'positions' | 'events' | 'executions';

export const UI_KEYS = {
  page: 'polywatch_page',
  systemTab: 'polywatch_system_tab',
  simTab: 'polywatch_sim_tab',
  snapshotsMode: 'polywatch_snapshots_mode',
  weatherAlgoTab: 'polywatch_weather_algo_tab',
  weatherAlgoPosTab: 'polywatch_weather_algo_pos_tab',
  weatherAlgoPosModeFilter: 'polywatch_weather_algo_pos_mode_filter',
  weatherAlgoPosOpenSubTab: 'polywatch_weather_algo_pos_open_sub_tab',
  weatherAlgoPosHistoryPage: 'polywatch_weather_algo_pos_history_page',
  weatherAlgoExecModeFilter: 'polywatch_weather_algo_exec_mode_filter',
  weatherAlgoExecStatusFilter: 'polywatch_weather_algo_exec_status_filter',
  weatherAlgoExecPage: 'polywatch_weather_algo_exec_page',
  weatherAlgoDataView: 'polywatch_weather_algo_data_view',
  weatherAlgoDataTableId: 'polywatch_weather_algo_data_table_id',
  weatherAlgoDataDetailMode: 'polywatch_weather_algo_data_detail_mode',
  weatherAlgoDataCity: 'polywatch_weather_algo_data_city',
  weatherAlgoDataFrom: 'polywatch_weather_algo_data_from',
  weatherAlgoDataTo: 'polywatch_weather_algo_data_to',
  weatherAlgoDataConditionId: 'polywatch_weather_algo_data_condition_id',
  weatherAlgoDataStrategyId: 'polywatch_weather_algo_data_strategy_id',
  weatherAlgoDataDecision: 'polywatch_weather_algo_data_decision',
  weatherAlgoDataPage: 'polywatch_weather_algo_data_page',
  weatherAlgoTimelineDate: 'polywatch_weather_algo_timeline_date',
  weatherAlgoTimelineMaxTicks: 'polywatch_weather_algo_timeline_max_ticks',
  weatherAlgoTimelineMinPrice: 'polywatch_weather_algo_timeline_min_price',
  weatherAlgoClobTimelineDate: 'polywatch_weather_algo_clob_timeline_date',
  weatherAlgoClobTimelineMaxTicks: 'polywatch_weather_algo_clob_timeline_max_ticks',
  weatherAlgoClobTimelineSide: 'polywatch_weather_algo_clob_timeline_side',
  weatherAlgoClobTimelineMinPrice: 'polywatch_weather_algo_clob_timeline_min_price',
  weatherAlgoClobTimelineFidelity: 'polywatch_weather_algo_clob_timeline_fidelity',
  weatherAlgoBacktestSelectedId: 'polywatch_weather_algo_backtest_selected_id',
  weatherAlgoBacktestPage: 'polywatch_weather_algo_backtest_page',
  positionsTab: (mode: UiMode) => `polywatch_positions_tab_${mode}`,
  positionsListLayout: (mode: UiMode) => `polywatch_positions_list_layout_${mode}`,
  positionsMarketNavWidth: (mode: UiMode) =>
    `polywatch_positions_market_nav_width_${mode}`,
  collapsed: (section: CollapsedSection, mode: UiMode) =>
    `polywatch_collapsed_${section}_${mode}`,
} as const;

export function readPersisted<T>(
  key: string,
  fallback: T,
  isValid?: (value: unknown) => value is T,
): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = raw;
    }

    if (isValid) {
      return isValid(parsed) ? parsed : fallback;
    }
    return parsed as T;
  } catch {
    return fallback;
  }
}

export function writePersisted(key: string, value: unknown): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore quota / private mode errors.
  }
}

export function usePersistedSignal<T>(
  key: string,
  fallback: T,
  isValid?: (value: unknown) => value is T,
): [Accessor<T>, Setter<T>] {
  const [value, setValue] = createSignal<T>(readPersisted(key, fallback, isValid));

  createEffect(() => {
    writePersisted(key, value());
  });

  return [value, setValue];
}

export function usePersistedEnum<T extends string>(
  key: string,
  fallback: T,
  valid: readonly T[],
): [Accessor<T>, Setter<T>] {
  return usePersistedSignal(
    key,
    fallback,
    (value): value is T =>
      typeof value === 'string' && (valid as readonly string[]).includes(value),
  );
}

export function usePersistedCollapse(
  section: CollapsedSection,
  mode: UiMode,
): [Accessor<boolean>, Setter<boolean>] {
  return usePersistedSignal(
    UI_KEYS.collapsed(section, mode),
    false,
    (value): value is boolean => typeof value === 'boolean',
  );
}
