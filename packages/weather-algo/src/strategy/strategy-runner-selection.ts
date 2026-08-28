import type { WeatherSignal } from './strategy.js';
import { normalizeWeatherCity } from '@polywatch/core';
import { DEFAULT_MAX_SIGNALS_PER_EVENT } from '../constants.js';
import type { WeatherConfig } from '@polywatch/core';
import pino from 'pino';

const log = pino({ name: 'weather-algo:strategy-runner' });

/**
 * Deduplicate weather signals by (normalized city, target date, strategy) lane,
 * keeping the highest-edge signal per lane. This yields at most one signal per
 * city+date per strategy, so a forecast-less strategy (e.g. highest-yes, edge=0)
 * is never silently discarded by a higher-edge forecast strategy on the same
 * city+date. Distinct dates of the same city form distinct lanes, allowing
 * multiple open positions across different target dates.
 */
export function dedupSignalsByCityDate(signals: WeatherSignal[]): WeatherSignal[] {
  const bestPerLane = new Map<string, WeatherSignal>();
  for (const signal of signals) {
    const cityKey = normalizeWeatherCity(signal.city);
    const dateIso = signal.targetDate.toISOString().slice(0, 10);
    const laneKey = `${cityKey}|${dateIso}|${signal.mode}::${signal.strategyId}`;
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
  // Single mode: pick the (city, targetDate) pair with the highest-edge signal,
  // then return all lane winners for that pair (multiple strategies).
  // This allows highest-yes (edge=0) to win as fallback on dates where
  // forecast strategies have no signal, instead of being shadowed by a
  // forecast signal on a different date of the same city.
  const sorted = [...signals].sort((a, b) => b.edge - a.edge);
  const best = sorted[0]!;
  const bestCity = normalizeWeatherCity(best.city);
  const bestDateIso = best.targetDate.toISOString().slice(0, 10);
  return sorted.filter(
    (s) =>
      normalizeWeatherCity(s.city) === bestCity &&
      s.targetDate.toISOString().slice(0, 10) === bestDateIso,
  );
}
