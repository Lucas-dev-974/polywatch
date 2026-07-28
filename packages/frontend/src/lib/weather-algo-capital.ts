import { api } from '../api';

/**
 * Capital snapshot for the weather-algo page.
 *
 * `sim` now includes full capital info (cash, equity, baselineCapital) since
 * each algo has its own SimulationBalance line.
 *
 * `real` is the global on-chain pUSD balance (shared Polymarket wallet), with
 * a note explaining the provenance.
 */
export interface WeatherAlgoCapital {
  sim: {
    equity: number;
    cash: number;
    positionsValue: number;
    openPnl: number;
    closedPnl: number;
    baselineCapital: number;
  } | null;
  real: {
    availableCash: number | null;
    note: string | null;
  };
}

export function formatWeatherAlgoCapital(value: number): string {
  if (!Number.isFinite(value)) return '\u2014';
  return value.toFixed(2) + ' pUSD';
}

export async function fetchWeatherAlgoCapital(): Promise<WeatherAlgoCapital> {
  return api<WeatherAlgoCapital>('/weather-algo/capital');
}
