import { describe, expect, it } from 'vitest';
import {
  mapVitestStatus,
  parseJsonSummary,
  parseStdoutSummary,
} from '../e2e/summary-parser.js';
import { getSuiteDefinition } from '../e2e/suites.js';

describe('parseStdoutSummary', () => {
  it('parses vitest pass-only output', () => {
    const summary = parseStdoutSummary(`
 Test Files  1 passed (1)
      Tests  6 passed (6)
`);
    expect(summary).toEqual({ total: 6, passed: 6, failed: 0, skipped: 0 });
  });

  it('parses vitest mixed output', () => {
    const summary = parseStdoutSummary(' Tests  2 failed | 4 passed (6)');
    expect(summary).toEqual({ total: 6, passed: 4, failed: 2, skipped: 0 });
  });

  it('parses playwright output', () => {
    const summary = parseStdoutSummary('  1 passed (5.2s)\n  1 failed');
    expect(summary).toEqual({ total: 2, passed: 1, failed: 1, skipped: 0 });
  });

  it('returns null for unrecognized output', () => {
    expect(parseStdoutSummary('nothing useful')).toBeNull();
  });
});

describe('mapVitestStatus', () => {
  it('maps Vitest JSON reporter statuses', () => {
    expect(mapVitestStatus('passed')).toBe('passed');
    expect(mapVitestStatus('failed')).toBe('failed');
    expect(mapVitestStatus('skipped')).toBe('skipped');
    expect(mapVitestStatus('todo')).toBe('skipped');
    expect(mapVitestStatus('pending')).toBe('skipped');
  });

  it('maps legacy pass/fail statuses', () => {
    expect(mapVitestStatus('pass')).toBe('passed');
    expect(mapVitestStatus('fail')).toBe('failed');
    expect(mapVitestStatus('skip')).toBe('skipped');
  });
});

describe('parseJsonSummary', () => {
  it('parses vitest json report with assertionResults (production format)', () => {
    const summary = parseJsonSummary(
      JSON.stringify({
        numTotalTests: 2,
        numPassedTests: 1,
        numFailedTests: 1,
        numPendingTests: 0,
        testResults: [
          {
            name: '/path/to/file.test.ts',
            status: 'failed',
            assertionResults: [
              {
                fullName: 'crypto-algo e2e opens position',
                title: 'opens position',
                ancestorTitles: ['crypto-algo e2e'],
                status: 'passed',
                duration: 10,
                failureMessages: [],
              },
              {
                fullName: 'crypto-algo e2e triggers SL',
                title: 'triggers SL',
                ancestorTitles: ['crypto-algo e2e'],
                status: 'failed',
                duration: 20,
                failureMessages: [
                  '\x1b[31mAssertionError: expected 0.5 to be 0.3\x1b[0m',
                  'at Object.<anonymous> (file.test.ts:42:5)',
                ],
                location: { file: '/path/to/file.test.ts', line: 42, column: 5 },
              },
            ],
          },
        ],
      }),
      'compliance',
    );
    expect(summary).toMatchObject({ total: 2, passed: 1, failed: 1, skipped: 0 });
    expect(summary?.tests).toHaveLength(2);
    expect(summary?.tests?.[0]).toMatchObject({
      status: 'passed',
      title: 'opens position',
      description: 'crypto-algo e2e',
    });
    expect(summary?.tests?.[0]?.failureMessages).toBeUndefined();
    expect(summary?.tests?.[1]).toMatchObject({
      status: 'failed',
      location: { file: '/path/to/file.test.ts', line: 42, column: 5 },
    });
    expect(summary?.tests?.[1]?.failureMessages?.[0]).toContain('AssertionError');
    expect(summary?.tests?.[1]?.failureMessages?.[0]).not.toContain('\x1b[');
  });

  it('parses vitest file-level failure without assertionResults', () => {
    const summary = parseJsonSummary(
      JSON.stringify({
        numTotalTests: 1,
        numFailedTests: 1,
        testResults: [
          {
            name: '/path/import-fail.test.ts',
            status: 'fail',
            message: 'Cannot find module "./missing"',
          },
        ],
      }),
      'crypto-algo',
    );
    expect(summary?.tests?.[0]).toMatchObject({
      status: 'failed',
      failureMessages: ['Cannot find module "./missing"'],
    });
  });

  it('parses playwright json report', () => {
    const summary = parseJsonSummary(
      JSON.stringify({
        stats: { expected: 1, unexpected: 0, skipped: 0 },
        suites: [
          {
            specs: [
              {
                title: 'login test',
                tests: [{ results: [{ status: 'passed', duration: 1000 }] }],
              },
            ],
          },
        ],
      }),
      'playwright',
    );
    expect(summary).toMatchObject({ total: 1, passed: 1, failed: 0, skipped: 0 });
    expect(summary?.tests?.[0]?.failureMessages).toBeUndefined();
  });

  it('parses playwright failed spec with error details', () => {
    const summary = parseJsonSummary(
      JSON.stringify({
        stats: { expected: 0, unexpected: 1, skipped: 0 },
        suites: [
          {
            specs: [
              {
                title: 'login test',
                tests: [
                  {
                    results: [
                      {
                        status: 'failed',
                        duration: 500,
                        error: {
                          message: 'expect(locator).toBeVisible() failed',
                          stack: 'Error: expect(locator).toBeVisible() failed\n    at login.spec.ts:5',
                          location: {
                            file: 'e2e/tests/login.spec.ts',
                            line: 5,
                            column: 3,
                          },
                        },
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      }),
      'playwright',
    );
    expect(summary?.tests?.[0]).toMatchObject({
      status: 'failed',
      location: { file: 'e2e/tests/login.spec.ts', line: 5, column: 3 },
    });
    expect(summary?.tests?.[0]?.failureMessages?.length).toBeGreaterThan(0);
  });

  it('parses nested playwright suites', () => {
    const summary = parseJsonSummary(
      JSON.stringify({
        stats: { expected: 2, unexpected: 0, skipped: 0 },
        suites: [
          {
            suites: [
              {
                specs: [
                  {
                    title: 'nested spec',
                    tests: [{ results: [{ status: 'passed', duration: 100 }] }],
                  },
                ],
              },
            ],
            specs: [
              {
                title: 'top spec',
                tests: [{ results: [{ status: 'passed', duration: 200 }] }],
              },
            ],
          },
        ],
      }),
      'playwright',
    );
    expect(summary?.tests).toHaveLength(2);
    expect(summary?.tests?.map((t) => t.name).sort()).toEqual(['nested spec', 'top spec']);
  });

  it('uses last playwright retry result', () => {
    const summary = parseJsonSummary(
      JSON.stringify({
        stats: { expected: 1, unexpected: 0, skipped: 0 },
        suites: [
          {
            specs: [
              {
                title: 'flaky test',
                tests: [
                  {
                    results: [
                      { status: 'failed', duration: 100, error: { message: 'first fail' } },
                      { status: 'passed', duration: 200 },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      }),
      'playwright',
    );
    expect(summary?.tests?.[0]).toMatchObject({ status: 'passed' });
    expect(summary?.tests?.[0]?.failureMessages).toBeUndefined();
  });
});

describe('getSuiteDefinition', () => {
  it('returns known suites', () => {
    expect(getSuiteDefinition('playwright')?.script).toBe('test:e2e');
    expect(getSuiteDefinition('crypto-algo-real')?.timeoutMs).toBe(25 * 60_000);
  });

  it('returns undefined for unknown suite', () => {
    expect(getSuiteDefinition('unknown')).toBeUndefined();
  });
});
