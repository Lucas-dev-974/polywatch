import { api, updateGlobalConfig } from '../api';

export interface AlgoCapital {
  sim: {
    equity: number;
    cash: number;
    positionsValue: number;
    openPnl: number;
    closedPnl: number;
    baselineCapital: number;
  };
  real: {
    availableCash: number | null;
    note: string | null;
  };
}

export function formatAlgoCapital(value: number): string {
  if (!Number.isFinite(value)) return '\u2014';
  return value.toFixed(2) + ' pUSD';
}

export async function fetchAlgoCapital(): Promise<AlgoCapital> {
  return api<AlgoCapital>('/algo/capital');
}

export async function updateRealTradingEnabled(enabled: boolean): Promise<void> {
  await updateGlobalConfig({ realTradingEnabled: enabled });
}
