import type { WeatherSignal } from './strategy.js';
import { normalizeWeatherCity } from '@polywatch/core';
import { DEFAULT_MAX_SIGNALS_PER_EVENT } from '../constants.js';
import type { WeatherConfig } from '@polywatch/core';
import pino from 'pino';

const log = pino({ name: 'weather-algo:strategy-runner' });

/**
 * Deduplicate weather signals by (normalized city, strategy) lane, keeping the
 * highest-edge signal per lane. This yields at most one signal per city per
 * strategy, so a forecast-less strategy (e.g. highest-yes, edge=0) is never
 * silently discarded by a higher-edge forecast strategy on the same city.
 */
export function dedupSignalsByCity(signals: WeatherSignal[]): WeatherSignal[] {
  const bestPerLane = new Map<string, WeatherSignal>();
  for (const signal of signals) {
    const cityKey = normalizeWeatherCity(signal.city);
    const laneKey = `${cityKey}::${signal.strategyId}`;
    const prev = bestPerLane.get(laneKey);
    if (!prev || signal.edge > prev.edge) {
      bestPerLane.set(laneKey, signal);
    }
  }
  return [...bestPerLane.values()];
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
    // Guarantee at least one signal per emitting strategy (lane), then fill the
    // remaining slots by descending edge.
    const bestPerStrategy = new Map<string, WeatherSignal>();
    for (const s of sorted) {
      if (!bestPerStrategy.has(s.strategyId)) bestPerStrategy.set(s.strategyId, s);
    }
    const guaranteed = [...bestPerStrategy.values()];
    const rest = sorted.filter((s) => !guaranteed.includes(s));
    return [...guaranteed, ...rest].slice(0, maxN);
  }

  if (mode !== 'single') {
    log.warn(
      { weatherAlgoSelectionMode: mode },
      'weather selection mode unknown — falling back to single',
    );
  }
  // Single mode: keep one signal per (city, strategy) lane. The runner's
  // per-city gate enforces the single-position-per-city business constraint,
  // so a forecast-less strategy remains a candidate and wins cities where the
  // forecast strategies abstained. Sorted by descending edge for a deterministic
  // order (forecast strategies with positive edge take precedence on ties).
  return [...signals].sort((a, b) => b.edge - a.edge);
}
