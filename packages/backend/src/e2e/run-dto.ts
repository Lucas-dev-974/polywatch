import { mkdirSync } from 'node:fs';
import { resolveMonorepoPath } from '@polywatch/core/config/env';
import type { E2eTestRun } from '@polywatch/core';

const E2E_RUNS_DIR = 'data/e2e-runs';

export function ensureE2eLogDir(): void {
  mkdirSync(resolveMonorepoPath(E2E_RUNS_DIR), { recursive: true });
}

export function buildRunArtifactPaths(runId: string): {
  logFilePath: string;
  resultsPath: string;
} {
  return {
    logFilePath: resolveMonorepoPath(`${E2E_RUNS_DIR}/${runId}.log`),
    resultsPath: resolveMonorepoPath(`${E2E_RUNS_DIR}/${runId}-results.json`),
  };
}

export function e2eRunToDto(run: E2eTestRun) {
  return {
    id: run.id,
    suite: run.suite,
    status: run.status,
    startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt?.toISOString() ?? null,
    durationMs: run.durationMs,
    exitCode: run.exitCode,
    summary: run.summary,
    triggeredBy: run.triggeredBy,
    errorMessage: run.errorMessage,
  };
}

export type E2eRunDto = ReturnType<typeof e2eRunToDto>;
