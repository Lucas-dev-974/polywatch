import type { WeatherConfig } from '../entities/WeatherConfig.js';
import { isExitLegEnabled } from './policy.js';
import {
  getStrategyParams,
  DEFAULT_WEATHER_STRATEGY_PARAMS,
} from '../weather/strategy-catalog.js';

/**
 * Fixed exit defaults for weather-algo positions.
 *
 * Weather markets have no interval (no `5m`/`10m`/...), so defaults are
 * scalar constants rather than an interval-keyed table. Percentages are
 * relative to the invested amount (cost basis + fees).
 */
export const WEATHER_EXIT_DEFAULTS = {
  trailingPercent: 10,
  trailingActivationPercent: 12,
  slPercent: 20,
  tpPercent: 25,
};

export interface WeatherEntryExitParams {
  trailingPercent: number | null;
  trailingActivationPercent: number | null;
  slPercent: number | null;
  tpPercent: number | null;
}

/**
 * Resolve a percentage-of-invested-amount SL/TP override.
 * Override (including 0/negative = disabled) → fixed default → null.
 *
 * Simplified copy of the crypto-algo equivalent — no interval dimension.
 */
function pickAlgoPercentThreshold(
  algoOverride: number | null | undefined,
  fallbackDefault: number | undefined,
): number | null {
  if (algoOverride != null) {
    return algoOverride > 0 ? algoOverride : null;
  }
  if (fallbackDefault != null && fallbackDefault > 0) {
    return fallbackDefault;
  }
  return null;
}

/**
 * Resolve SL/TP/trailing percentages for a weather-algo position at entry
 * time.
 *
 * Each leg is gated by its own enable flag on `WeatherConfig`; when enabled:
 * override (including 0 = disabled) → fixed default → null.
 *
 * The `mode` parameter is accepted for interface compatibility but has no
 * effect — weather exits are identical in sim and real.
 *
 * The `_interval` parameter is ignored (weather markets have no interval).
 */
export function resolveWeatherEntryExitParams(
  weatherConfig: WeatherConfig,
  _mode: 'sim' | 'real',
  _interval?: string | null,
  strategyId?: string | null,
): WeatherEntryExitParams {
  const bag = strategyId
    ? getStrategyParams(weatherConfig, strategyId)
    : DEFAULT_WEATHER_STRATEGY_PARAMS;
  const slPercent = isExitLegEnabled(bag.slEnabled)
    ? pickAlgoPercentThreshold(bag.slPercent, WEATHER_EXIT_DEFAULTS.slPercent)
    : null;

  const tpPercent = isExitLegEnabled(bag.tpEnabled)
    ? pickAlgoPercentThreshold(bag.tpPercent, WEATHER_EXIT_DEFAULTS.tpPercent)
    : null;

  const trailingEnabled = isExitLegEnabled(bag.trailingEnabled);

  return {
    trailingPercent: trailingEnabled
      ? pickAlgoPercentThreshold(
          bag.trailingPercent,
          WEATHER_EXIT_DEFAULTS.trailingPercent,
        )
      : null,
    trailingActivationPercent: trailingEnabled
      ? pickAlgoPercentThreshold(
          bag.trailingActivationPercent,
          WEATHER_EXIT_DEFAULTS.trailingActivationPercent,
        )
      : null,
    slPercent,
    tpPercent,
  };
}
