import type { E2eSuiteId } from '@polywatch/core';

export interface E2eSuiteDefinition {
  id: E2eSuiteId;
  label: string;
  description: string;
  script: string;
  timeoutMs: number;
  extraArgs?: string[];
  env?: Record<string, string>;
  requiresConfirmation?: boolean;
}

export const E2E_SUITES: E2eSuiteDefinition[] = [
  {
    id: 'playwright',
    label: 'Playwright UI',
    description: 'Test navigateur — login et dashboard',
    script: 'test:e2e',
    timeoutMs: 120_000,
    extraArgs: ['--reporter=list', '--reporter=json'],
  },
  {
    id: 'crypto-algo',
    label: 'Crypto-algo (mock)',
    description: 'Pipeline algo en mémoire — SL, TP, trailing, pre-close',
    script: 'test:e2e:crypto',
    timeoutMs: 90_000,
  },
  {
    id: 'crypto-algo-real',
    label: 'Crypto-algo (real-sim)',
    description: 'Chaîne complète sur Polymarket live — peut durer jusqu\'à 20 min',
    script: 'test:e2e:crypto:real',
    timeoutMs: 25 * 60_000,
    env: { RUN_REAL_SIM_E2E: '1' },
    requiresConfirmation: true,
  },
  {
    id: 'compliance',
    label: 'Compliance audit',
    description: 'Vérifications audit sim + real',
    script: 'test:compliance',
    timeoutMs: 60_000,
  },
];

const SUITE_BY_ID = new Map(E2E_SUITES.map((s) => [s.id, s]));

export function getSuiteDefinition(suiteId: string): E2eSuiteDefinition | undefined {
  return SUITE_BY_ID.get(suiteId as E2eSuiteId);
}

export function isValidSuiteId(suiteId: string): suiteId is E2eSuiteId {
  return SUITE_BY_ID.has(suiteId as E2eSuiteId);
}
