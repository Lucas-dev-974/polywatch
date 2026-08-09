import type { WeatherConfig } from '../entities/WeatherConfig.js';

export const WEATHER_FORECAST_STRATEGY_ID = 'weather-forecast' as const;
export const WEATHER_FORECAST_ALIGNED_STRATEGY_ID = 'weather-forecast-aligned' as const;

export const WEATHER_STRATEGY_IDS = [
  WEATHER_FORECAST_STRATEGY_ID,
  WEATHER_FORECAST_ALIGNED_STRATEGY_ID,
] as const;

export type WeatherStrategyId = (typeof WEATHER_STRATEGY_IDS)[number];

export type StrategyParamKind = 'number' | 'boolean' | 'select';

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
 * Per-strategy params (declarative). Entry gates (minEdge, minProb, maxStd) stay on
 * WeatherConfig global knobs — both forecast strategies share them via setRiskConfig.
 * Add strategy-specific keys here when a strategy needs its own tunables.
 */
export const WEATHER_STRATEGY_CATALOG: WeatherStrategyMeta[] = [
  {
    id: WEATHER_FORECAST_STRATEGY_ID,
    label: 'Forecast (best edge)',
    description:
      'Évalue tous les paliers actifs et choisit celui avec le plus grand edge YES (pickBestEdgeBucket).',
    supportsGroup: true,
    params: [],
  },
  {
    id: WEATHER_FORECAST_ALIGNED_STRATEGY_ID,
    label: 'Forecast (aligned)',
    description:
      'Choisit le palier dont la fourchette contient le forecast mean (selectForecastAlignedBucket), puis applique les gates edge.',
    supportsGroup: true,
    params: [],
  },
];

export function getWeatherStrategyMeta(id: string): WeatherStrategyMeta | undefined {
  return WEATHER_STRATEGY_CATALOG.find((s) => s.id === id);
}

export function isKnownWeatherStrategyId(id: string): id is WeatherStrategyId {
  return (WEATHER_STRATEGY_IDS as readonly string[]).includes(id);
}

const DEFAULT_STRATEGIES_JSON = JSON.stringify([WEATHER_FORECAST_STRATEGY_ID]);
const DEFAULT_PARAMS_JSON = '{}';

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

export type WeatherStrategyParamsMap = Record<string, Record<string, number | boolean | string>>;

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

export function getStrategyParams(
  config: Pick<WeatherConfig, 'weatherAlgoStrategyParams'>,
  strategyId: string,
): Record<string, number | boolean | string> {
  const meta = getWeatherStrategyMeta(strategyId);
  const stored = parseWeatherAlgoStrategyParams(config.weatherAlgoStrategyParams)[strategyId] ?? {};
  const merged: Record<string, number | boolean | string> = {};
  for (const schema of meta?.params ?? []) {
    const v = stored[schema.key];
    merged[schema.key] = v !== undefined ? v : schema.default;
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
  for (const [strategyId, bag] of Object.entries(params ?? {})) {
    if (!isKnownWeatherStrategyId(strategyId)) continue;
    const meta = getWeatherStrategyMeta(strategyId);
    if (!meta) continue;
    const allowedKeys = new Set(meta.params.map((p) => p.key));
    const cleaned: Record<string, number | boolean | string> = {};
    for (const [key, value] of Object.entries(bag ?? {})) {
      if (allowedKeys.has(key)) cleaned[key] = value;
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
      const schema = meta.params.find((p) => p.key === key)!;
      if (schema.kind === 'number' && typeof value !== 'number') {
        errors.push({ strategyId, key, message: 'expected number' });
      } else if (schema.kind === 'boolean' && typeof value !== 'boolean') {
        errors.push({ strategyId, key, message: 'expected boolean' });
      } else if (schema.kind === 'select' && typeof value !== 'string') {
        errors.push({ strategyId, key, message: 'expected string' });
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

export { DEFAULT_STRATEGIES_JSON, DEFAULT_PARAMS_JSON };
