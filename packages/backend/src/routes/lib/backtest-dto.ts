import type { BacktestRun } from '@polywatch/core';

export interface RunDto {
  id: number;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  status: string;
  progressPct: number;
  domain: string;
  mode: string;
  label: string | null;
  params: unknown;
  dataRangeFrom: string | null;
  dataRangeTo: string | null;
  stats: unknown;
  fidelityWarnings: unknown;
  engineVersion: string | null;
  error: string | null;
}

export function toRunDto(run: BacktestRun): RunDto {
  return {
    id: run.id,
    createdAt: run.createdAt.toISOString(),
    startedAt: run.startedAt ? run.startedAt.toISOString() : null,
    finishedAt: run.finishedAt ? run.finishedAt.toISOString() : null,
    status: run.status,
    progressPct: run.progressPct,
    domain: run.domain,
    mode: run.mode,
    label: run.label,
    params: safeParseJson(run.paramsJson),
    dataRangeFrom: run.dataRangeFrom ? run.dataRangeFrom.toISOString() : null,
    dataRangeTo: run.dataRangeTo ? run.dataRangeTo.toISOString() : null,
    stats: safeParseJson(run.statsJson),
    fidelityWarnings: safeParseJson(run.fidelityWarningsJson),
    engineVersion: run.engineVersion,
    error: run.error,
  };
}

function safeParseJson(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
