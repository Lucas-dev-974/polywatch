import type { SimArchiveSummary, SimResetRedisPurgeResult } from '@polywatch/core';
import { DEFAULT_SIM_BALANCE } from '@polywatch/core/simulation/constants';
import { api } from '../api';

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
  amount?: number;
  archive?: boolean;
  deepClean?: boolean;
  newSessionLabel?: string | null;
}

export async function fetchSimBalance(): Promise<SimBalance> {
  return api<SimBalance>('/simulation-balance');
}

export async function fetchSimInitialCapital(): Promise<number> {
  const { simInitialCapital } = await api<{ simInitialCapital?: number }>(
    '/risk-config',
  );
  return simInitialCapital ?? DEFAULT_SIM_BALANCE;
}

export async function resetSimulation(
  options?: ResetSimulationOptions | number,
): Promise<SimResetResult> {
  const opts: ResetSimulationOptions =
    typeof options === 'number' ? { amount: options } : (options ?? {});
  const capital = opts.amount ?? (await fetchSimInitialCapital());
  return api<SimResetResult>('/simulation-balance/reset', {
    method: 'POST',
    body: JSON.stringify({
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
