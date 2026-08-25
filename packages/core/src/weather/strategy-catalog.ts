import type { WeatherConfig } from '../entities/WeatherConfig.js';

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
  /** Min YES market price required to emit a signal (highest-yes strategy). */
  minYesPrice: number;
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
  /** Fixed entry notional (USDC). */
  entryUsdc: number;
  /** Sizing mode. Currently only fixed_usdc is wired to the runtime. */
  sizingMode: 'fixed_usdc' | 'fixed_shares';
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
  maxExposureUsdc: number;
  maxDailyLossUsdc: number;
  maxPositionSizeUsdc: number;
  // ── Depth retry / confirmation ─────────────────────────────────────
  entryDepthRetryMax: number;
  entryDepthRetryDelayMs: number;
  slCloseMaxRetries: number;
  slConfirmationTicks: number;
  // ── Kill switch ────────────────────────────────────────────────────
  killSwitchAction: 'block_entries' | 'force_close_all' | 'block_and_notify';
  // ── Misc ───────────────────────────────────────────────────────────
  allowedMarketTags: string[];
  signalScoreSizingEnabled: boolean;
  minBidToAskRatio: number;
  minTimeToClose: number;
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
  minYesPrice: 0.5,
  maxYesPrice: null,
  allowedComparisons: null,
  maxPositionsPerCityDate: 1,
  entryUsdc: 10,
  sizingMode: 'fixed_usdc',
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
  maxExposureUsdc: 1000,
  maxDailyLossUsdc: 100,
  maxPositionSizeUsdc: 200,
  entryDepthRetryMax: 3,
  entryDepthRetryDelayMs: 1000,
  slCloseMaxRetries: 5,
  slConfirmationTicks: 2,
  killSwitchAction: 'block_entries',
  allowedMarketTags: [],
  signalScoreSizingEnabled: true,
  minBidToAskRatio: 0.9,
  minTimeToClose: 0,
};

const SIZING_MODE_OPTIONS = [
  { value: 'fixed_usdc', label: 'Fixed USDC' },
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
    // Sizing
    { key: 'entryUsdc', label: 'Taille d’entrée (USDC)', kind: 'number', min: 1, max: 10000, step: 1, default: 10 },
    { key: 'sizingMode', label: 'Mode de sizing', kind: 'select', options: SIZING_MODE_OPTIONS, default: 'fixed_usdc' },
    { key: 'fixedShareCount', label: 'Nombre de parts (fixed_shares)', kind: 'number', min: 1, max: 10_000_000, step: 1, default: 100, hint: 'Nombre fixe de parts à acheter quand le mode de sizing est fixed_shares. Ignoré en mode fixed_usdc.' },
    // Exit
    { key: 'forecastChangeThreshold', label: 'Seuil de dérive forecast (°C)', kind: 'number', min: 0.5, max: 20, step: 0.5, default: 2, hint: 'Déclenche WEATHER_FORECAST_CHANGE.' },
    { key: 'bucketHysteresisPolls', label: 'Hystérésis bucket (polls)', kind: 'number', min: 1, max: 10, step: 1, default: 2 },
    { key: 'reentryThrottleMs', label: 'Ré-entrée après sortie bucket/drift (ms)', kind: 'number', min: 0, max: 86_400_000, step: 60_000, default: 1_800_000, hint: 'Pause après WEATHER_BUCKET_EXIT ou WEATHER_FORECAST_CHANGE.' },
    { key: 'reentryThrottleAfterSlMs', label: 'Ré-entrée après stop-loss (ms)', kind: 'number', min: 0, max: 86_400_000, step: 60_000, default: 1_800_000, hint: '0 = désactivé. Pause après une sortie SL avant de rouvrir le même couple ville+date.' },
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
    { key: 'maxExposureUsdc', label: 'Exposition max (USDC)', kind: 'number', min: 1, max: 100_000, step: 100, default: 1000 },
    { key: 'maxDailyLossUsdc', label: 'Perte journalière max (USDC)', kind: 'number', min: 1, max: 100_000, step: 10, default: 100 },
    { key: 'maxPositionSizeUsdc', label: 'Taille de position max (USDC)', kind: 'number', min: 1, max: 100_000, step: 10, default: 200 },
    // Depth retry / confirmation
    { key: 'entryDepthRetryMax', label: 'Retries profondeur', kind: 'number', min: 0, max: 10, step: 1, default: 3 },
    { key: 'entryDepthRetryDelayMs', label: 'Délai retry profondeur (ms)', kind: 'number', min: 0, max: 60_000, step: 100, default: 1000 },
    { key: 'slCloseMaxRetries', label: 'Retries fermeture SL', kind: 'number', min: 0, max: 20, step: 1, default: 5 },
    { key: 'slConfirmationTicks', label: 'Confirmation SL (ticks)', kind: 'number', min: 1, max: 10, step: 1, default: 2 },
    // Kill switch
    { key: 'killSwitchAction', label: 'Action kill-switch', kind: 'select', options: KILL_SWITCH_OPTIONS, default: 'block_entries' },
    // Misc
    { key: 'signalScoreSizingEnabled', label: 'Sizing par score de signal', kind: 'boolean', default: true },
    { key: 'minBidToAskRatio', label: 'Ratio bid/ask min', kind: 'number', min: 0, max: 1, step: 0.05, default: 0.9 },
    { key: 'minTimeToClose', label: 'Temps min avant fermeture (s)', kind: 'number', min: 0, max: 86_400, step: 30, default: 0 },
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
    { key: 'entryUsdc', label: 'Taille d’entrée (USDC)', kind: 'number', min: 1, max: 10000, step: 1, default: 10 },
    { key: 'sizingMode', label: 'Mode de sizing', kind: 'select', options: SIZING_MODE_OPTIONS, default: 'fixed_usdc' },
    { key: 'fixedShareCount', label: 'Nombre de parts (fixed_shares)', kind: 'number', min: 1, max: 10_000_000, step: 1, default: 100, hint: 'Nombre fixe de parts à acheter quand le mode de sizing est fixed_shares. Ignoré en mode fixed_usdc.' },
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
    { key: 'reentryThrottleMs', label: 'Ré-entrée après sortie bucket/drift (ms)', kind: 'number', min: 0, max: 86_400_000, step: 60_000, default: 1_800_000, hint: 'Pause après WEATHER_BUCKET_EXIT ou WEATHER_FORECAST_CHANGE.' },
    { key: 'reentryThrottleAfterSlMs', label: 'Ré-entrée après stop-loss (ms)', kind: 'number', min: 0, max: 86_400_000, step: 60_000, default: 1_800_000, hint: '0 = désactivé. Pause après une sortie SL.' },
    { key: 'maxReentriesPerCityDate', label: 'Max entrées par ville+date', kind: 'number', min: 0, max: 20, step: 1, default: 2, hint: '0 = illimité. Limite les re-entrées après SL sur le même marché ville+date.' },
    // Risk limits
    { key: 'maxOpenPositions', label: 'Max positions ouvertes', kind: 'number', min: 1, max: 50, step: 1, default: 10 },
    { key: 'maxPositionsPerCityDate', label: 'Max positions par ville+date', kind: 'number', min: 1, max: 10, step: 1, default: 1, hint: 'Nombre max de positions ouvertes simultanément pour un même couple (ville, date cible).' },
    { key: 'maxExposureUsdc', label: 'Exposition max (USDC)', kind: 'number', min: 1, max: 100_000, step: 100, default: 1000 },
    { key: 'maxDailyLossUsdc', label: 'Perte journalière max (USDC)', kind: 'number', min: 1, max: 100_000, step: 10, default: 100 },
    { key: 'maxPositionSizeUsdc', label: 'Taille de position max (USDC)', kind: 'number', min: 1, max: 100_000, step: 10, default: 200 },
    // Depth retry / confirmation
    { key: 'entryDepthRetryMax', label: 'Retries profondeur', kind: 'number', min: 0, max: 10, step: 1, default: 3 },
    { key: 'entryDepthRetryDelayMs', label: 'Délai retry profondeur (ms)', kind: 'number', min: 0, max: 60_000, step: 100, default: 1000 },
    { key: 'slCloseMaxRetries', label: 'Retries fermeture SL', kind: 'number', min: 0, max: 20, step: 1, default: 5 },
    { key: 'slConfirmationTicks', label: 'Confirmation SL (ticks)', kind: 'number', min: 1, max: 10, step: 1, default: 2 },
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
      'Filet de sécurité sans forecast : sélectionne le palier au prix YES le plus élevé (consensus marché). edge=0 — ne gagne qu’en l’absence de signal forecast. Tient jusqu’à résolution. Utiliser allowedComparisons pour exclure les paliers cumulatifs (or_above/or_below).',
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

/** Stored per-strategy params: partial bags keyed by strategy id. */
export type WeatherStrategyParamsMap = Record<string, Partial<WeatherStrategyParamsBag>>;

export function parseWeatherAlgoStrategyParams(
  raw: string | null | undefined,
): WeatherStrategyParamsMap {
  if (!raw || raw.trim() === '') return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as WeatherStrategyParamsMap;
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
  'maxYesPrice',
  'slPercent',
  'tpPercent',
  'trailingPercent',
  'trailingActivationPercent',
]);

/**
 * Keys whose catalogue default is NOT null. A stored `null` on such a key
 * would otherwise override the default and silently disable the gate (e.g.
 * `minYesPrice: null` disables the floor, letting near-zero YES prices
 * through). We force these back to the catalogue default when stored null.
 */
const NON_NULLABLE_DEFAULTS: (keyof WeatherStrategyParamsBag)[] = (
  Object.entries(DEFAULT_WEATHER_STRATEGY_PARAMS) as [keyof WeatherStrategyParamsBag, unknown][]
)
  .filter(([, v]) => v !== null)
  .map(([k]) => k);

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
  const merged: WeatherStrategyParamsBag = { ...DEFAULT_WEATHER_STRATEGY_PARAMS, ...stored };
  for (const key of NULLABLE_ZERO_KEYS) {
    if ((merged as Record<string, unknown>)[key] === 0) {
      (merged as Record<string, unknown>)[key] = null;
    }
  }
  // Un `null` stocké sur un champ à défaut non-null retombe sur le défaut
  // (ex. minYesPrice: null → 0.5). Les champs nullable par conception
  // (défaut null) restent null = désactivé.
  for (const key of NON_NULLABLE_DEFAULTS) {
    if ((merged as Record<string, unknown>)[key] === null) {
      (merged as Record<string, unknown>)[key] = DEFAULT_WEATHER_STRATEGY_PARAMS[key];
    }
  }
  return merged;
}

export function resolveEnabledWeatherStrategies(
  config: Pick<WeatherConfig, 'weatherAlgoStrategies'>,
): WeatherStrategyId[] {
  return parseWeatherAlgoStrategies(config.weatherAlgoStrategies);
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
    for (const [key, value] of Object.entries(bag ?? {})) {
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
