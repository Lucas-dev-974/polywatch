import type { WeatherConfig } from '../entities/WeatherConfig.js';
import { isExitLegEnabled } from './policy.js';

/**
 * Fixed exit defaults for weather-algo positions.
 *
 * Weather markets have no interval (no `5m`/`10m`/...), so defaults are
 * scalar constants rather than an interval-keyed table.
 */
export const WEATHER_EXIT_DEFAULTS = {
  trailingBidPoints: 0.05,
  trailingActivationBidPoints: 0.06,
  slBidPoints: 0.10,
  tpBidPoints: 0.12,
};

export interface WeatherEntryExitParams {
  trailingBidPoints: number | null;
  trailingActivationBidPoints: number | null;
  slBidPoints: number | null;
  tpBidPoints: number | null;
}

/**
 * Resolve a bid-points SL/TP override for a binary market.
 * Override (including 0/negative = disabled) → fixed default → null.
 *
 * Simplified copy of the crypto-algo equivalent — no interval dimension.
 */
function pickAlgoBidPointsThreshold(
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
 * Resolve SL/TP/trailing bid points for a weather-algo position at entry
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
): WeatherEntryExitParams {
  const slBidPoints = isExitLegEnabled(weatherConfig.weatherAlgoSlEnabled)
    ? pickAlgoBidPointsThreshold(
        weatherConfig.weatherAlgoSlBidPoints,
        WEATHER_EXIT_DEFAULTS.slBidPoints,
      )
    : null;

  const tpBidPoints = isExitLegEnabled(weatherConfig.weatherAlgoTpEnabled)
    ? pickAlgoBidPointsThreshold(
        weatherConfig.weatherAlgoTpBidPoints,
        WEATHER_EXIT_DEFAULTS.tpBidPoints,
      )
    : null;

  const trailingEnabled = isExitLegEnabled(weatherConfig.weatherAlgoTrailingEnabled);

  return {
    trailingBidPoints: trailingEnabled
      ? pickAlgoBidPointsThreshold(
          weatherConfig.weatherAlgoTrailingBidPoints,
          WEATHER_EXIT_DEFAULTS.trailingBidPoints,
        )
      : null,
    trailingActivationBidPoints: trailingEnabled
      ? pickAlgoBidPointsThreshold(
          weatherConfig.weatherAlgoTrailingActivationBidPoints,
          WEATHER_EXIT_DEFAULTS.trailingActivationBidPoints,
        )
      : null,
    slBidPoints,
    tpBidPoints,
  };
}
