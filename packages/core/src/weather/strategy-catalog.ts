import type { WeatherConfig } from '../entities/WeatherConfig.js';
import type { TradingMode } from '../types/index.js';

export const WEATHER_FORECAST_STRATEGY_ID = 'weather-forecast' as const;
export const WEATHER_FORECAST_ALIGNED_STRATEGY_ID = 'weather-forecast-aligned' as const;
export const WEATHER_HIGHEST_YES_STRATEGY_ID = 'weather-highest-yes' as const;

export const WEATHER_STRATEGY_IDS = [
  WEATHER_FORECAST_STRATEGY_ID,
  WEATHER_FORECAST_ALIGNED_STRATEGY_ID,
  WEATHER_HIGHEST_YES_STRATEGY_ID,
] as const;

export type WeatherStrategyId = (typeof WEATHER_STRATEGY_IDS)[number];

export type StrategyParamKind = 'number' | 'boolean' | 'select';

/** Bucket comparison types a weather market can express. */
export type WeatherComparison = 'exact' | 'or_below' | 'or_above' | 'between';

export type StrategyParamSchema = {
  key: string;
  label: string;
  kind: StrategyParamKind;
  min?: number;
  max?: number;
  step?: number;
  options?: Array<{ value: string; label: string }>;
  default: number | boolean | string;
  hint?: string;
};

export type WeatherStrategyMeta = {
  id: WeatherStrategyId;
  label: string;
  description: string;
  supportsGroup: boolean;
  params: StrategyParamSchema[];
};

/**
 * Typed per-strategy tunables for the weather-algo.
 *
 * Each strategy carries its own complete trading config (entry gates, sizing,
 * exits, SL/TP/trailing, risk limits, kill-switch). Stored as a JSON object
 * under `weatherAlgoStrategyParams[strategyId]`. Absent keys fall back to
 * `DEFAULT_WEATHER_STRATEGY_PARAMS` (catalogue defaults), never to global
 * WeatherConfig columns.
 */
export type WeatherStrategyParamsBag = {
  // ── Entry gates ────────────────────────────────────────────────────
  /** Min YES edge required to emit a signal. */
  minEdge: number;
  /** Max forecast std dev; null disables the filter. */
  maxForecastStd: number | null;
  /** Min forecast-implied YES probability; null disables the filter. */
  minForecastProbability: number | null;
  /**
   * Min YES market price required to emit a signal. Null disables the floor.
   * Highest-yes overlays a catalogue default of 0.5 (bug run #40); forecast
   * strategies stay off until the user sets a value.
   */
  minYesPrice: number | null;
  /**
   * Max YES price ceiling for entry (highest-yes strategy). Null disables the
   * filter. Acts as an anti-fade gate: refuse to buy a bucket whose YES price
   * is already so high that the upside to resolution (≈ 1.0) is too thin.
   */
  maxYesPrice: number | null;
  /**
   * Bucket comparisons eligible for the highest-yes strategy. Empty array or
   * null = all comparisons accepted (default). Use to exclude cumulative
   * buckets (or_above / or_below) whose YES price is mechanically inflated
   * by P(T ≥ threshold) and would dominate the "highest YES" selection.
   */
  allowedComparisons: WeatherComparison[] | null;
  /** Max simultaneous open positions for a single (city, target date) pair. */
  maxPositionsPerCityDate: number;
  // ── Sizing ─────────────────────────────────────────────────────────
  /** Fixed entry notional (pUSD). */
  entryPusd: number;
  /** Sizing mode. Currently only fixed_pusd is wired to the runtime. */
  sizingMode: 'fixed_pusd' | 'fixed_shares';
  /** Fixed share count for 'fixed_shares' sizing mode. */
  fixedShareCount: number;
  // ── Exit ───────────────────────────────────────────────────────────
  /** Forecast mean change (delta °C) triggering WEATHER_FORECAST_CHANGE. */
  forecastChangeThreshold: number;
  /** Consecutive out-of-bucket polls before WEATHER_BUCKET_EXIT. */
  bucketHysteresisPolls: number;
  /** Pause after bucket/drift close before re-entering the same city. */
  reentryThrottleMs: number;
  /** Pause after SL close before re-entering the same city+date. 0 = disabled. */
  reentryThrottleAfterSlMs: number;
  /**
   * Max entries (including the first) per city+date+strategy for the run.
   * 0 = unlimited.
   */
  maxReentriesPerCityDate: number;
  /** City-follow switch mode on bucket exit. */
  cityFollowSwitchMode: 'close_and_reenter' | 'hold';
  // ── SL / TP / Trailing ─────────────────────────────────────────────
  slEnabled: boolean;
  tpEnabled: boolean;
  trailingEnabled: boolean;
  /** Stop-loss threshold as % of the invested amount (cost basis + fees). */
  slPercent: number | null;
  /** Take-profit threshold as % of the invested amount (cost basis + fees). */
  tpPercent: number | null;
  /** Trailing drawdown threshold as % of the invested amount. */
  trailingPercent: number | null;
  /** Trailing activation threshold as % of the invested amount. */
  trailingActivationPercent: number | null;
  // ── Risk limits ────────────────────────────────────────────────────
  maxOpenPositions: number;
  maxExposurePusd: number;
  maxDailyLossPusd: number;
  maxPositionSizePusd: number;
  // ── Depth retry / confirmation ─────────────────────────────────────
  entryDepthRetryMax: number;
  entryDepthRetryDelayMs: number;
  slCloseMaxRetries: number;
  slConfirmationTicks: number;
  /**
   * Min ask depth (shares) required at the entry price before emitting a
   * signal. The depth retry gate uses max(orderQty, minAskDepthShares); order
   * quantity is unchanged. 0 = disabled.
   */
  minAskDepthShares: number;
  /**
   * Extra ticks added to the FAK limit price on entry (taker aggressiveness)
   * to improve fill odds on thin books. 0 = disabled. Clamped 0-3.
   */
  entryTickPad: number;
  // ── Kill switch ────────────────────────────────────────────────────
  killSwitchAction: 'block_entries' | 'force_close_all' | 'block_and_notify';
  // ── Misc ───────────────────────────────────────────────────────────
  signalScoreSizingEnabled: boolean;
};

/**
 * Catalogue defaults for a weather strategy. Absent keys in the stored params
 * bag fall back to these values. Reflects the WeatherConfig column defaults
 * (kept only as reference — the runtime reads the bag, not the columns).
 */
export const DEFAULT_WEATHER_STRATEGY_PARAMS: WeatherStrategyParamsBag = {
  minEdge: 0.1,
  maxForecastStd: null,
  minForecastProbability: null,
  minYesPrice: null,
  maxYesPrice: null,
  allowedComparisons: null,
  maxPositionsPerCityDate: 1,
  entryPusd: 10,
  sizingMode: 'fixed_pusd',
  fixedShareCount: 100,
  forecastChangeThreshold: 2,
  bucketHysteresisPolls: 2,
  reentryThrottleMs: 1_800_000,
  reentryThrottleAfterSlMs: 1_800_000,
  maxReentriesPerCityDate: 2,
  cityFollowSwitchMode: 'close_and_reenter',
  slEnabled: true,
  tpEnabled: true,
  trailingEnabled: true,
  slPercent: null,
  tpPercent: null,
  trailingPercent: null,
  trailingActivationPercent: null,
  maxOpenPositions: 10,
  maxExposurePusd: 1000,
  maxDailyLossPusd: 100,
  maxPositionSizePusd: 200,
  entryDepthRetryMax: 3,
  entryDepthRetryDelayMs: 1000,
  slCloseMaxRetries: 5,
  slConfirmationTicks: 2,
  minAskDepthShares: 0,
  entryTickPad: 1,
  killSwitchAction: 'block_entries',
  signalScoreSizingEnabled: true,
};

const SIZING_MODE_OPTIONS = [
  { value: 'fixed_pusd', label: 'Fixed pUSD' },
  { value: 'fixed_shares', label: 'Fixed Shares' },
];

const CITY_FOLLOW_OPTIONS = [
  { value: 'close_and_reenter', label: 'Fermer et rouvrir' },
  { value: 'hold', label: 'Tenir (pas de fermeture bucket)' },
];

const KILL_SWITCH_OPTIONS = [
  { value: 'block_entries', label: 'Bloquer les entrées' },
  { value: 'force_close_all', label: 'Forcer la fermeture totale' },
  { value: 'block_and_notify', label: 'Bloquer et notifier' },
];

/**
 * UI schemas shared by both forecast strategies. Nullable numeric knobs use a
 * sentinel default (0 = disabled) for the form; the runtime bag keeps `null`.
 */
function sharedParamsSchemas(): StrategyParamSchema[] {
  return [
    // Entry gates
    { key: 'minEdge', label: 'Edge minimal (YES)', kind: 'number', min: 0.01, max: 0.5, step: 0.01, default: 0.1, hint: 'Écart minimal entre probabilité forecast et prix marché.' },
    { key: 'maxForecastStd', label: 'Écart-type forecast max', kind: 'number', min: 0, max: 20, step: 0.5, default: 0, hint: '0 = désactivé. Filtre les forecasts trop incertains.' },
    { key: 'minForecastProbability', label: 'Probabilité YES min', kind: 'number', min: 0, max: 1, step: 0.05, default: 0, hint: '0 = désactivé. Filtre les buckets très peu probables.' },
    { key: 'minYesPrice', label: 'Prix YES minimal', kind: 'number', min: 0, max: 1, step: 0.01, default: 0, hint: '0 = désactivé. Seuil de consensus : n’entre que si le prix YES du bucket est >= ce seuil.' },
    // Sizing
    { key: 'entryPusd', label: 'Taille d’entrée (pUSD)', kind: 'number', min: 1, max: 10000, step: 1, default: 10 },
    { key: 'sizingMode', label: 'Mode de sizing', kind: 'select', options: SIZING_MODE_OPTIONS, default: 'fixed_pusd' },
    { key: 'fixedShareCount', label: 'Nombre de parts (fixed_shares)', kind: 'number', min: 1, max: 10_000_000, step: 1, default: 100, hint: 'Nombre fixe de parts à acheter quand le mode de sizing est fixed_shares. Ignoré en mode fixed_pusd.' },
    // Exit
    { key: 'forecastChangeThreshold', label: 'Seuil de dérive forecast (°C)', kind: 'number', min: 0.5, max: 20, step: 0.5, default: 2, hint: 'Déclenche WEATHER_FORECAST_CHANGE.' },
    { key: 'bucketHysteresisPolls', label: 'Hystérésis bucket (polls)', kind: 'number', min: 1, max: 10, step: 1, default: 2 },
    { key: 'reentryThrottleMs', label: 'Ré-entrée après sortie bucket/drift (ms)', kind: 'number', min: 0, max: 86_400_000, step: 1000, default: 1_800_000, hint: 'Pause après WEATHER_BUCKET_EXIT ou WEATHER_FORECAST_CHANGE.' },
    { key: 'reentryThrottleAfterSlMs', label: 'Ré-entrée après stop-loss (ms)', kind: 'number', min: 0, max: 86_400_000, step: 1000, default: 1_800_000, hint: '0 = désactivé. Pause après une sortie SL avant de rouvrir le même couple ville+date.' },
    { key: 'maxReentriesPerCityDate', label: 'Max entrées par ville+date', kind: 'number', min: 0, max: 20, step: 1, default: 2, hint: '0 = illimité. Nombre max de positions ouvertes (cumul) sur un même couple ville+date — limite les allers-retours SL.' },
    { key: 'cityFollowSwitchMode', label: 'Mode suivi ville', kind: 'select', options: CITY_FOLLOW_OPTIONS, default: 'close_and_reenter' },
    // SL / TP / Trailing
    { key: 'slEnabled', label: 'Stop-loss actif', kind: 'boolean', default: true },
    { key: 'tpEnabled', label: 'Take-profit actif', kind: 'boolean', default: true },
    { key: 'trailingEnabled', label: 'Trailing actif', kind: 'boolean', default: true },
    { key: 'slPercent', label: 'SL (%)', kind: 'number', min: 0, max: 100, step: 1, default: 0, hint: '0 = désactivé. Pourcentage de la mise investie.' },
    { key: 'tpPercent', label: 'TP (%)', kind: 'number', min: 0, max: 100, step: 1, default: 0, hint: '0 = désactivé. Pourcentage de la mise investie.' },
    { key: 'trailingPercent', label: 'Trailing (%)', kind: 'number', min: 0, max: 100, step: 1, default: 0, hint: '0 = désactivé. Drawdown en % de la mise investie.' },
    { key: 'trailingActivationPercent', label: 'Trailing activation (%)', kind: 'number', min: 0, max: 100, step: 1, default: 0, hint: '0 = désactivé. Gain en % de la mise investie pour armer le trailing.' },
    // Risk limits
    { key: 'maxOpenPositions', label: 'Max positions ouvertes', kind: 'number', min: 1, max: 50, step: 1, default: 10 },
    { key: 'maxPositionsPerCityDate', label: 'Max positions par ville+date', kind: 'number', min: 1, max: 10, step: 1, default: 1, hint: 'Nombre max de positions ouvertes simultanément pour un même couple (ville, date cible).' },
    { key: 'maxExposurePusd', label: 'Exposition max (pUSD)', kind: 'number', min: 1, max: 100_000, step: 1, default: 1000 },
    { key: 'maxDailyLossPusd', label: 'Perte journalière max (pUSD)', kind: 'number', min: 1, max: 100_000, step: 1, default: 100 },
    { key: 'maxPositionSizePusd', label: 'Taille de position max (pUSD)', kind: 'number', min: 1, max: 100_000, step: 1, default: 200 },
    // Depth retry / confirmation
    { key: 'entryDepthRetryMax', label: 'Retries profondeur', kind: 'number', min: 0, max: 10, step: 1, default: 3 },
    { key: 'entryDepthRetryDelayMs', label: 'Délai retry profondeur (ms)', kind: 'number', min: 0, max: 60_000, step: 100, default: 1000 },
    { key: 'slCloseMaxRetries', label: 'Retries fermeture SL', kind: 'number', min: 0, max: 20, step: 1, default: 5 },
    { key: 'slConfirmationTicks', label: 'Confirmation SL (ticks)', kind: 'number', min: 1, max: 10, step: 1, default: 2 },
    { key: 'minAskDepthShares', label: 'Profondeur ask min (parts)', kind: 'number', min: 0, max: 1_000_000, step: 1, default: 0, hint: '0 = désactivé. Profondeur ask minimale requise à l’entrée ; le gate de profondeur vérifie max(quantité, seuil) sans modifier la quantité envoyée.' },
    { key: 'entryTickPad', label: 'Pad d’entrée (ticks)', kind: 'number', min: 0, max: 3, step: 1, default: 1, hint: '0 = désactivé. Ticks ajoutés au prix limite FAK à l’entrée (agressivité taker) pour améliorer le fill sur carnet fin. Défaut 1 = comportement legacy +1 tick. Clampé 0-3.' },
    // Kill switch
    { key: 'killSwitchAction', label: 'Action kill-switch', kind: 'select', options: KILL_SWITCH_OPTIONS, default: 'block_entries' },
    // Misc
    { key: 'signalScoreSizingEnabled', label: 'Sizing par score de signal', kind: 'boolean', default: true },
  ];
}

/**
 * UI schemas for the highest-yes strategy (no forecast). Reuses the shared
 * sizing / exit / risk / SL-TP / kill-switch / pre-close knobs but replaces
 * the forecast entry gates with a single `minYesPrice` consensus threshold.
 */
function highestYesParamsSchemas(): StrategyParamSchema[] {
  const COMPARISON_OPTIONS = [
    { value: 'exact', label: 'Exact (=)' },
    { value: 'between', label: 'Entre (between)' },
    { value: 'or_above', label: 'Ou au-dessus (≥)' },
    { value: 'or_below', label: 'Ou en-dessous (≤)' },
  ];
  return [
    // Entry gate
    { key: 'minYesPrice', label: 'Prix YES minimal', kind: 'number', min: 0.01, max: 1, step: 0.01, default: 0.5, hint: 'Seuil de consensus : n’entre que si le prix YES du bucket est >= ce seuil.' },
    { key: 'maxYesPrice', label: 'Prix YES maximal', kind: 'number', min: 0, max: 1, step: 0.01, default: 0, hint: '0 = désactivé. Anti-fade : n’entre que si le prix YES du bucket est <= ce plafond (upside restant vers la résolution trop fin sinon).' },
    {
      key: 'allowedComparisons',
      label: 'Comparaisons éligibles',
      kind: 'select',
      options: COMPARISON_OPTIONS,
      default: 'exact',
      hint: 'Restreint les types de paliers. Les paliers « or above / or below » ont un prix YES cumulatif mécaniquement gonflé — les exclure évite le biais de sur-achat.',
    },
    // Sizing
    { key: 'entryPusd', label: 'Taille d’entrée (pUSD)', kind: 'number', min: 1, max: 10000, step: 1, default: 10 },
    { key: 'sizingMode', label: 'Mode de sizing', kind: 'select', options: SIZING_MODE_OPTIONS, default: 'fixed_pusd' },
    { key: 'fixedShareCount', label: 'Nombre de parts (fixed_shares)', kind: 'number', min: 1, max: 10_000_000, step: 1, default: 100, hint: 'Nombre fixe de parts à acheter quand le mode de sizing est fixed_shares. Ignoré en mode fixed_pusd.' },
    // Exit
    // SL / TP / Trailing
    { key: 'slEnabled', label: 'Stop-loss actif', kind: 'boolean', default: true },
    { key: 'tpEnabled', label: 'Take-profit actif', kind: 'boolean', default: true },
    { key: 'trailingEnabled', label: 'Trailing actif', kind: 'boolean', default: true },
    { key: 'slPercent', label: 'SL (%)', kind: 'number', min: 0, max: 100, step: 1, default: 0, hint: '0 = désactivé. Pourcentage de la mise investie.' },
    { key: 'tpPercent', label: 'TP (%)', kind: 'number', min: 0, max: 100, step: 1, default: 0, hint: '0 = désactivé. Pourcentage de la mise investie.' },
    { key: 'trailingPercent', label: 'Trailing (%)', kind: 'number', min: 0, max: 100, step: 1, default: 0, hint: '0 = désactivé. Drawdown en % de la mise investie.' },
    { key: 'trailingActivationPercent', label: 'Trailing activation (%)', kind: 'number', min: 0, max: 100, step: 1, default: 0, hint: '0 = désactivé. Gain en % de la mise investie pour armer le trailing.' },
    // Re-entry guards
    { key: 'reentryThrottleMs', label: 'Ré-entrée après sortie bucket/drift (ms)', kind: 'number', min: 0, max: 86_400_000, step: 1000, default: 1_800_000, hint: 'Pause après WEATHER_BUCKET_EXIT ou WEATHER_FORECAST_CHANGE.' },
    { key: 'reentryThrottleAfterSlMs', label: 'Ré-entrée après stop-loss (ms)', kind: 'number', min: 0, max: 86_400_000, step: 1000, default: 1_800_000, hint: '0 = désactivé. Pause après une sortie SL.' },
    { key: 'maxReentriesPerCityDate', label: 'Max entrées par ville+date', kind: 'number', min: 0, max: 20, step: 1, default: 2, hint: '0 = illimité. Limite les re-entrées après SL sur le même marché ville+date.' },
    // Risk limits
    { key: 'maxOpenPositions', label: 'Max positions ouvertes', kind: 'number', min: 1, max: 50, step: 1, default: 10 },
    { key: 'maxPositionsPerCityDate', label: 'Max positions par ville+date', kind: 'number', min: 1, max: 10, step: 1, default: 1, hint: 'Nombre max de positions ouvertes simultanément pour un même couple (ville, date cible).' },
    { key: 'maxExposurePusd', label: 'Exposition max (pUSD)', kind: 'number', min: 1, max: 100_000, step: 1, default: 1000 },
    { key: 'maxDailyLossPusd', label: 'Perte journalière max (pUSD)', kind: 'number', min: 1, max: 100_000, step: 1, default: 100 },
    { key: 'maxPositionSizePusd', label: 'Taille de position max (pUSD)', kind: 'number', min: 1, max: 100_000, step: 1, default: 200 },
    // Depth retry / confirmation
    { key: 'entryDepthRetryMax', label: 'Retries profondeur', kind: 'number', min: 0, max: 10, step: 1, default: 3 },
    { key: 'entryDepthRetryDelayMs', label: 'Délai retry profondeur (ms)', kind: 'number', min: 0, max: 60_000, step: 100, default: 1000 },
    { key: 'slCloseMaxRetries', label: 'Retries fermeture SL', kind: 'number', min: 0, max: 20, step: 1, default: 5 },
    { key: 'slConfirmationTicks', label: 'Confirmation SL (ticks)', kind: 'number', min: 1, max: 10, step: 1, default: 2 },
    { key: 'minAskDepthShares', label: 'Profondeur ask min (parts)', kind: 'number', min: 0, max: 1_000_000, step: 1, default: 0, hint: '0 = désactivé. Profondeur ask minimale requise à l’entrée ; le gate de profondeur vérifie max(quantité, seuil) sans modifier la quantité envoyée.' },
    { key: 'entryTickPad', label: 'Pad d’entrée (ticks)', kind: 'number', min: 0, max: 3, step: 1, default: 1, hint: '0 = désactivé. Ticks ajoutés au prix limite FAK à l’entrée (agressivité taker) pour améliorer le fill sur carnet fin. Défaut 1 = comportement legacy +1 tick. Clampé 0-3.' },
    // Kill switch
    { key: 'killSwitchAction', label: 'Action kill-switch', kind: 'select', options: KILL_SWITCH_OPTIONS, default: 'block_entries' },
    // Misc
    { key: 'signalScoreSizingEnabled', label: 'Sizing par score de signal', kind: 'boolean', default: true },
  ];
}

export const WEATHER_STRATEGY_CATALOG: WeatherStrategyMeta[] = [
  {
    id: WEATHER_FORECAST_STRATEGY_ID,
    label: 'Forecast (best edge)',
    description:
      'Évalue tous les paliers actifs et choisit celui avec le plus grand edge YES (pickBestEdgeBucket).',
    supportsGroup: true,
    params: sharedParamsSchemas(),
  },
  {
    id: WEATHER_FORECAST_ALIGNED_STRATEGY_ID,
    label: 'Forecast (aligned)',
    description:
      'Choisit le palier dont la fourchette contient le forecast mean (selectForecastAlignedBucket), puis applique les gates edge.',
    supportsGroup: true,
    params: sharedParamsSchemas(),
  },
  {
    id: WEATHER_HIGHEST_YES_STRATEGY_ID,
    label: 'Highest YES (consensus)',
    description:
      'Sans forecast : sélectionne le palier au prix YES le plus élevé (consensus marché). edge=0. Stratégie autonome (pas un fallback first-wins). Tient jusqu’à résolution. Utiliser allowedComparisons pour exclure les paliers cumulatifs (or_above/or_below).',
    supportsGroup: true,
    params: highestYesParamsSchemas(),
  },
];

export function getWeatherStrategyMeta(id: string): WeatherStrategyMeta | undefined {
  return WEATHER_STRATEGY_CATALOG.find((s) => s.id === id);
}

export function isKnownWeatherStrategyId(id: string): id is WeatherStrategyId {
  return (WEATHER_STRATEGY_IDS as readonly string[]).includes(id);
}

export function parseWeatherAlgoStrategies(raw: string | null | undefined): WeatherStrategyId[] {
  if (!raw || raw.trim() === '') {
    return [WEATHER_FORECAST_STRATEGY_ID];
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [WEATHER_FORECAST_STRATEGY_ID];
    const ids = parsed.filter((x): x is WeatherStrategyId => isKnownWeatherStrategyId(String(x)));
    return ids.length > 0 ? ids : [WEATHER_FORECAST_STRATEGY_ID];
  } catch {
    return [WEATHER_FORECAST_STRATEGY_ID];
  }
}

export function serializeWeatherAlgoStrategies(ids: string[]): string {
  return JSON.stringify(ids);
}

export type ClampEnabledWeatherStrategiesResult = {
  enabled: WeatherStrategyId[];
  dropped: WeatherStrategyId[];
};

/**
 * Per env, at most one weather strategy may be active.
 *
 * - unique already-enabled id: keep it (even if it is not first in the catalogue)
 * - several enabled (legacy bag): keep the first in catalogue order, treat the
 *   rest as off
 */
export function clampEnabledWeatherStrategies(
  ids: WeatherStrategyId[],
): ClampEnabledWeatherStrategiesResult {
  const unique: WeatherStrategyId[] = [];
  for (const id of ids) {
    if (!unique.includes(id)) unique.push(id);
  }
  if (unique.length <= 1) {
    return { enabled: unique, dropped: [] };
  }
  const kept = WEATHER_STRATEGY_IDS.find((id) => unique.includes(id)) ?? unique[0]!;
  return {
    enabled: [kept],
    dropped: unique.filter((id) => id !== kept),
  };
}

/** Stored per-strategy params: partial bags keyed by strategy id. */
export type WeatherStrategyParamsMap = Record<string, Partial<WeatherStrategyParamsBag>>;

/**
 * Pre-rename bag keys / values still present in DB rows that have not yet
 * run `RenameUsdcToPusdSizing1700000000122`, or in a fresh migrate where
 * 0107/0108 wrote `entryPusd` but copied `sizingMode` from a still-`fixed_usdc`
 * column. Read + sanitize must heal these or weather sizing silently no-ops
 * (`SPEND_STRATEGIES['fixed_usdc']` is undefined) and a settings save would
 * drop `entryUsdc` as an unknown key.
 */
const LEGACY_WEATHER_BAG_KEYS: Record<string, keyof WeatherStrategyParamsBag> = {
  entryUsdc: 'entryPusd',
  maxExposureUsdc: 'maxExposurePusd',
  maxDailyLossUsdc: 'maxDailyLossPusd',
  maxPositionSizeUsdc: 'maxPositionSizePusd',
};

function migrateLegacyWeatherBag(
  bag: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...bag };
  for (const [legacy, current] of Object.entries(LEGACY_WEATHER_BAG_KEYS)) {
    if (!(current in out) || out[current] == null) {
      if (legacy in out && out[legacy] != null) {
        out[current] = out[legacy];
      }
    }
    delete out[legacy];
  }
  if (out.sizingMode === 'fixed_usdc') {
    out.sizingMode = 'fixed_pusd';
  }
  return out;
}

export function parseWeatherAlgoStrategyParams(
  raw: string | null | undefined,
): WeatherStrategyParamsMap {
  if (!raw || raw.trim() === '') return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: WeatherStrategyParamsMap = {};
    for (const [strategyId, bag] of Object.entries(parsed as Record<string, unknown>)) {
      if (!bag || typeof bag !== 'object' || Array.isArray(bag)) continue;
      out[strategyId] = migrateLegacyWeatherBag(bag as Record<string, unknown>) as Partial<WeatherStrategyParamsBag>;
    }
    return out;
  } catch {
    return {};
  }
}

export function serializeWeatherAlgoStrategyParams(params: WeatherStrategyParamsMap): string {
  return JSON.stringify(params ?? {});
}

/**
 * Keys whose stored value `0` means "disabled" (nullable numeric knobs). A
 * stored `0` is coerced to `null` so the runtime treats it as an inactive
 * filter / leg instead of an active zero-width gate.
 */
const NULLABLE_ZERO_KEYS = new Set([
  'maxForecastStd',
  'minForecastProbability',
  'minYesPrice',
  'maxYesPrice',
  'slPercent',
  'tpPercent',
  'trailingPercent',
  'trailingActivationPercent',
]);

/**
 * Per-strategy overlays on `DEFAULT_WEATHER_STRATEGY_PARAMS`. Highest-yes
 * keeps a 0.5 YES-price floor (stored `null` must not disable it — bug run
 * #40). Forecast strategies inherit the shared `minYesPrice: null` (off).
 */
const PER_STRATEGY_PARAM_DEFAULTS: Partial<
  Record<WeatherStrategyId, Partial<WeatherStrategyParamsBag>>
> = {
  [WEATHER_HIGHEST_YES_STRATEGY_ID]: { minYesPrice: 0.5 },
};

function catalogueDefaultsFor(strategyId: string): WeatherStrategyParamsBag {
  const overlay = isKnownWeatherStrategyId(strategyId)
    ? PER_STRATEGY_PARAM_DEFAULTS[strategyId]
    : undefined;
  return overlay
    ? { ...DEFAULT_WEATHER_STRATEGY_PARAMS, ...overlay }
    : { ...DEFAULT_WEATHER_STRATEGY_PARAMS };
}

/**
 * Resolve the full per-strategy params bag: catalogue defaults overlaid with
 * the stored partial bag for the strategy. Absent keys fall back to catalogue
 * defaults — never to global WeatherConfig columns.
 */
export function getStrategyParams(
  config: Pick<WeatherConfig, 'weatherAlgoStrategyParams'>,
  strategyId: string,
): WeatherStrategyParamsBag {
  const stored = parseWeatherAlgoStrategyParams(config.weatherAlgoStrategyParams)[strategyId] ?? {};
  const defaults = catalogueDefaultsFor(strategyId);
  const merged: WeatherStrategyParamsBag = { ...defaults, ...stored };
  for (const key of NULLABLE_ZERO_KEYS) {
    if ((merged as Record<string, unknown>)[key] === 0) {
      (merged as Record<string, unknown>)[key] = null;
    }
  }
  // Un `null` stocké sur un champ à défaut non-null retombe sur le défaut
  // (ex. highest-yes minYesPrice: null → 0.5). Les champs nullable par
  // conception (défaut null, dont minYesPrice forecast/aligned) restent
  // null = désactivé.
  for (const key of Object.keys(defaults) as (keyof WeatherStrategyParamsBag)[]) {
    if (defaults[key] !== null && (merged as Record<string, unknown>)[key] === null) {
      (merged as Record<string, unknown>)[key] = defaults[key];
    }
  }
  return merged;
}

export function resolveEnabledWeatherStrategies(
  config: Pick<WeatherConfig, 'weatherAlgoStrategies'>,
): WeatherStrategyId[] {
  return clampEnabledWeatherStrategies(parseWeatherAlgoStrategies(config.weatherAlgoStrategies)).enabled;
}

/**
 * Per-mode resolution of the active strategy ids.
 *
 * Reads the raw `simWeatherAlgoStrategies` / `realWeatherAlgoStrategies`
 * column. Falls back to the legacy `weatherAlgoStrategies` column **only when
 * the raw value is undefined / null / ''** — never after
 * `parseWeatherAlgoStrategies`, which already collapses empty/invalid values
 * to `['weather-forecast']` (otherwise the fallback would never fire). A
 * populated `'{}'` / `'[]'` does NOT fall back (`'[]'` already parses to the
 * forecast default).
 *
 * The resolved list is then clamped to at most one id (see
 * `clampEnabledWeatherStrategies`) so a legacy multi-id bag cannot reintroduce
 * a first-strategy-wins catalogue cascade.
 */
export function resolveEnabledWeatherStrategiesForMode(
  config: Pick<
    WeatherConfig,
    'weatherAlgoStrategies' | 'simWeatherAlgoStrategies' | 'realWeatherAlgoStrategies'
  >,
  mode: TradingMode,
): WeatherStrategyId[] {
  const raw =
    mode === 'sim' ? config.simWeatherAlgoStrategies : config.realWeatherAlgoStrategies;
  const effectiveRaw =
    raw === undefined || raw === null || raw === '' ? config.weatherAlgoStrategies : raw;
  return clampEnabledWeatherStrategies(parseWeatherAlgoStrategies(effectiveRaw)).enabled;
}

function rawStrategyParamsForMode(
  config: Pick<
    WeatherConfig,
    'weatherAlgoStrategyParams' | 'simWeatherAlgoStrategyParams' | 'realWeatherAlgoStrategyParams'
  >,
  mode: TradingMode,
): string | null | undefined {
  const raw =
    mode === 'sim' ? config.simWeatherAlgoStrategyParams : config.realWeatherAlgoStrategyParams;
  return raw === undefined || raw === null || raw === ''
    ? config.weatherAlgoStrategyParams
    : raw;
}

/**
 * Per-mode resolution of the strategy params bag for a given strategy.
 * Reads the params from the correct environment map, falling back to the
 * legacy global map only when the per-mode raw value is empty.
 */
export function getStrategyParamsForMode(
  config: Pick<
    WeatherConfig,
    | 'weatherAlgoStrategyParams'
    | 'simWeatherAlgoStrategyParams'
    | 'realWeatherAlgoStrategyParams'
  >,
  strategyId: string,
  mode: TradingMode,
): WeatherStrategyParamsBag {
  return getStrategyParams(
    { weatherAlgoStrategyParams: rawStrategyParamsForMode(config, mode) ?? '{}' },
    strategyId,
  );
}

export type StrategyParamsValidationError = { strategyId: string; key: string; message: string };

/** Drop unknown strategy ids / keys (e.g. retired catalogue params). */
export function sanitizeWeatherStrategyParams(
  params: WeatherStrategyParamsMap,
): WeatherStrategyParamsMap {
  const out: WeatherStrategyParamsMap = {};
  const allowedKeys = new Set(Object.keys(DEFAULT_WEATHER_STRATEGY_PARAMS));
  for (const [strategyId, bag] of Object.entries(params ?? {})) {
    if (!isKnownWeatherStrategyId(strategyId)) continue;
    const cleaned: Partial<WeatherStrategyParamsBag> = {};
    const migrated = migrateLegacyWeatherBag((bag ?? {}) as Record<string, unknown>);
    for (const [key, value] of Object.entries(migrated)) {
      if (allowedKeys.has(key)) (cleaned as Record<string, unknown>)[key] = value;
    }
    if (Object.keys(cleaned).length > 0) out[strategyId] = cleaned;
  }
  return out;
}

export function validateWeatherStrategyParamsUpdate(
  strategies: string[],
  params: WeatherStrategyParamsMap,
): StrategyParamsValidationError[] {
  const errors: StrategyParamsValidationError[] = [];
  const sanitized = sanitizeWeatherStrategyParams(params);
  for (const strategyId of Object.keys(sanitized)) {
    const meta = getWeatherStrategyMeta(strategyId)!;
    for (const [key, value] of Object.entries(sanitized[strategyId] ?? {})) {
      const schema = meta.params.find((p) => p.key === key);
      if (!schema) continue;
      if (schema.kind === 'number' && typeof value !== 'number') {
        if (value === null && NULLABLE_ZERO_KEYS.has(key)) {
          // Null = knob désactivé (nullable numeric knob). Legit, skip.
          continue;
        }
        errors.push({ strategyId, key, message: 'expected number' });
      } else if (schema.kind === 'boolean' && typeof value !== 'boolean') {
        errors.push({ strategyId, key, message: 'expected boolean' });
      } else if (schema.kind === 'select' && typeof value !== 'string') {
        errors.push({ strategyId, key, message: 'expected string' });
      } else if (schema.kind === 'select' && typeof value === 'string') {
        const optionValues = (schema.options ?? []).map((o) => o.value);
        if (optionValues.length > 0 && !optionValues.includes(value)) {
          errors.push({ strategyId, key, message: `must be one of ${optionValues.join(', ')}` });
        }
      } else if (schema.kind === 'number' && typeof value === 'number') {
        if (schema.min != null && value < schema.min) {
          errors.push({ strategyId, key, message: `min ${schema.min}` });
        }
        if (schema.max != null && value > schema.max) {
          errors.push({ strategyId, key, message: `max ${schema.max}` });
        }
      }
    }
  }
  for (const id of strategies) {
    if (!isKnownWeatherStrategyId(id)) {
      errors.push({ strategyId: id, key: '*', message: 'unknown strategy id in list' });
    }
  }
  return errors;
}
