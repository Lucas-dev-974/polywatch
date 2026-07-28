import type { SimArchiveSummary, SimResetRedisPurgeResult } from '@polywatch/core';
import { DEFAULT_SIM_BALANCE } from '@polywatch/core/simulation/constants';
import { api } from '../api';

export type SimAlgoKind = 'crypto' | 'weather' | 'copy';

export interface SimBalance {
  amount: number;
  token: string;
  positionsValue: number;
  equity: number;
  openPnlSum: number;
  closedPnlSum: number;
  baselineCapital?: number;
}

export interface SimResetResult extends SimBalance {
  archiveSummary?: SimArchiveSummary | null;
  redisPurge?: SimResetRedisPurgeResult | null;
  warnings?: string[];
}

export interface ResetSimulationOptions {
  algoKind: SimAlgoKind;
  amount?: number;
  archive?: boolean;
  deepClean?: boolean;
  newSessionLabel?: string | null;
}

export async function fetchSimBalance(algoKind: SimAlgoKind = 'crypto'): Promise<SimBalance> {
  return api<SimBalance>(`/simulation-balance?algoKind=${algoKind}`);
}

export async function fetchSimInitialCapital(
  algoKind: SimAlgoKind = 'crypto',
): Promise<number> {
  const risk = await api<{
    simInitialCapital?: number;
    simInitialCapitalCrypto?: number;
    simInitialCapitalWeather?: number;
    simInitialCapitalCopy?: number;
  }>('/risk-config');
  switch (algoKind) {
    case 'weather':
      return risk.simInitialCapitalWeather ?? DEFAULT_SIM_BALANCE;
    case 'copy':
      return risk.simInitialCapitalCopy ?? DEFAULT_SIM_BALANCE;
    default:
      return risk.simInitialCapitalCrypto ?? risk.simInitialCapital ?? DEFAULT_SIM_BALANCE;
  }
}

export async function resetSimulation(
  options: ResetSimulationOptions | number,
): Promise<SimResetResult> {
  const opts: ResetSimulationOptions =
    typeof options === 'number' ? { algoKind: 'crypto', amount: options } : options;
  const capital =
    opts.amount ?? (await fetchSimInitialCapital(opts.algoKind));
  return api<SimResetResult>('/simulation-balance/reset', {
    method: 'POST',
    body: JSON.stringify({
      algoKind: opts.algoKind,
      amount: capital,
      archive: opts.archive ?? true,
      deepClean: opts.deepClean ?? false,
      newSessionLabel: opts.newSessionLabel ?? null,
    }),
  });
}

export function formatSimCapital(amount: number): string {
  return amount.toLocaleString('fr-FR');
}
