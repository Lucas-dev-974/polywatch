import type { WeatherSignal } from './strategy.js';
import { normalizeWeatherCity } from '@polywatch/core';
import { DEFAULT_MAX_SIGNALS_PER_EVENT } from '../constants.js';
import type { WeatherConfig } from '@polywatch/core';
import pino from 'pino';

const log = pino({ name: 'weather-algo:strategy-runner' });

/**
 * Deduplicate weather signals by city, keeping only the highest-edge signal per
 * normalized city.
 */
export function dedupSignalsByCity(signals: WeatherSignal[]): WeatherSignal[] {
  const bestPerCity = new Map<string, WeatherSignal>();
  for (const signal of signals) {
    const cityKey = normalizeWeatherCity(signal.city);
    const prev = bestPerCity.get(cityKey);
    if (!prev || signal.edge > prev.edge) {
      bestPerCity.set(cityKey, signal);
    }
  }
  return [...bestPerCity.values()];
}

export function applySelectionMode(
  signals: WeatherSignal[],
  risk: WeatherConfig | null,
): WeatherSignal[] {
  if (signals.length === 0) return [];
  if (!risk) return signals;

  const mode = risk.weatherAlgoSelectionMode ?? 'single';

  if (mode === 'multi') {
    const maxN = risk.weatherAlgoMaxSignalsPerEvent ?? DEFAULT_MAX_SIGNALS_PER_EVENT;
    const sorted = [...signals].sort((a, b) => b.edge - a.edge);
    return sorted.slice(0, maxN);
  }

  if (mode !== 'single') {
    log.warn(
      { weatherAlgoSelectionMode: mode },
      'weather selection mode unknown — falling back to single',
    );
  }
  const best = signals.reduce((a, b) => (b.edge > a.edge ? b : a));
  return [best];
}
