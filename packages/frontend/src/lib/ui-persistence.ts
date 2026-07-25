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

export const POSITION_TABS = ['open', 'redemption', 'failed', 'history'] as const;

export const POSITION_LIST_LAYOUTS = ['flat', 'split'] as const;
export type PositionListLayout = (typeof POSITION_LIST_LAYOUTS)[number];

export type CollapsedSection = 'positions' | 'events' | 'executions';

export const UI_KEYS = {
  page: 'polywatch_page',
  systemTab: 'polywatch_system_tab',
  simTab: 'polywatch_sim_tab',
  snapshotsMode: 'polywatch_snapshots_mode',
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
