import type { InlineConfig } from 'vitest';

/** JSON report path when launched from the E2E UI (E2E_RUN_ID is set by the backend). */
export function e2eVitestReporters(): NonNullable<InlineConfig['reporters']> {
  const runId = process.env.E2E_RUN_ID;
  if (runId) {
    return [
      'verbose',
      ['json', { outputFile: `data/e2e-runs/${runId}-results.json` }],
    ];
  }
  return ['verbose'];
}
