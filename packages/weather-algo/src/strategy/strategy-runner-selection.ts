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
    // Selection is inside the one active strategy (cities/dates), not across
    // strategies. Top N by edge.
    return [...signals].sort((a, b) => b.edge - a.edge).slice(0, maxN);
  }

  if (mode !== 'single') {
    log.warn(
      { weatherAlgoSelectionMode: mode },
      'weather selection mode unknown — falling back to single',
    );
  }
  // Single mode applies inside the one active strategy: pick the
  // (city, targetDate) pair with the highest-edge signal of that strategy.
  const sorted = [...signals].sort((a, b) => b.edge - a.edge);
  const best = sorted[0]!;
  const bestCity = normalizeWeatherCity(best.city);
  const bestDateIso = best.targetDate.toISOString().slice(0, 10);
  return sorted.filter(
    (s) =>
      s.strategyId === best.strategyId &&
      normalizeWeatherCity(s.city) === bestCity &&
      s.targetDate.toISOString().slice(0, 10) === bestDateIso,
  );
}
