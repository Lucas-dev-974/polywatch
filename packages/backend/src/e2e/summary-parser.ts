import type {
  E2eRunSummary,
  E2eSuiteId,
  E2eTestCaseLocation,
  E2eTestCaseSummary,
} from '@polywatch/core';

const MAX_FAILURE_MSG_LEN = 4_000;
const MAX_SUMMARY_JSON_BYTES = 50_000;

export function parseStdoutSummary(output: string): E2eRunSummary | null {
  const vitestMatch = output.match(
    /Tests\s+(\d+)\s+failed\s+\|\s+(\d+)\s+passed(?:\s+\((\d+)\))?/,
  );
  if (vitestMatch) {
    const failed = Number(vitestMatch[1]);
    const passed = Number(vitestMatch[2]);
    const total = Number(vitestMatch[3] ?? failed + passed);
    return { total, passed, failed, skipped: Math.max(0, total - passed - failed) };
  }

  const vitestPassOnly = output.match(/Tests\s+(\d+)\s+passed(?:\s+\((\d+)\))?/);
  if (vitestPassOnly) {
    const passed = Number(vitestPassOnly[1]);
    const total = Number(vitestPassOnly[2] ?? passed);
    return { total, passed, failed: 0, skipped: Math.max(0, total - passed) };
  }

  const pwMatch = output.match(/(\d+)\s+passed(?:\s+\((\d+\.?\d*s)\))?/);
  const pwFailed = output.match(/(\d+)\s+failed/);
  if (pwMatch) {
    const passed = Number(pwMatch[1]);
    const failed = pwFailed ? Number(pwFailed[1]) : 0;
    return { total: passed + failed, passed, failed, skipped: 0 };
  }

  return null;
}

interface VitestAssertionResult {
  title: string;
  fullName?: string;
  ancestorTitles?: string[];
  status: string;
  duration?: number;
  failureMessages?: string[];
  location?: { file?: string; line?: number; column?: number };
}

interface VitestTestResult {
  name: string;
  status: string;
  message?: string;
  assertionResults?: VitestAssertionResult[];
}

interface VitestJsonReport {
  testResults?: VitestTestResult[];
  numTotalTests?: number;
  numPassedTests?: number;
  numFailedTests?: number;
  numPendingTests?: number;
}

interface PlaywrightTestError {
  message?: string;
  stack?: string;
  location?: E2eTestCaseLocation;
  matcherResult?: {
    name?: string;
    expected?: unknown;
    actual?: unknown;
    message?: string;
  };
}

interface PlaywrightTestResult {
  status?: string;
  duration?: number;
  error?: PlaywrightTestError;
  errorLocation?: E2eTestCaseLocation;
}

interface PlaywrightSpec {
  title: string;
  tests?: Array<{ results?: PlaywrightTestResult[] }>;
}

interface PlaywrightSuite {
  title?: string;
  specs?: PlaywrightSpec[];
  suites?: PlaywrightSuite[];
}

interface PlaywrightJsonReport {
  suites?: PlaywrightSuite[];
  stats?: { expected?: number; unexpected?: number; skipped?: number };
}

export function parseJsonSummary(
  jsonContent: string,
  suiteId: E2eSuiteId,
): E2eRunSummary | null {
  try {
    const data = JSON.parse(jsonContent) as VitestJsonReport & PlaywrightJsonReport;

    if (suiteId === 'playwright' && data.suites) {
      const tests: E2eTestCaseSummary[] = [];
      collectPlaywrightSpecs(data.suites, tests, []);
      const passed = data.stats?.expected ?? tests.filter((t) => t.status === 'passed').length;
      const failed = data.stats?.unexpected ?? tests.filter((t) => t.status === 'failed').length;
      const skipped = data.stats?.skipped ?? tests.filter((t) => t.status === 'skipped').length;
      return capSummarySize({
        total: passed + failed + skipped,
        passed,
        failed,
        skipped,
        tests,
      });
    }

    if (data.testResults) {
      const tests: E2eTestCaseSummary[] = [];
      for (const fileResult of data.testResults) {
        if (!fileResult.assertionResults || fileResult.assertionResults.length === 0) {
          const status = mapVitestStatus(fileResult.status);
          tests.push({
            name: fileResult.name,
            status,
            durationMs: undefined,
            failureMessages: buildFailureMessages(
              status === 'failed' ? [fileResult.message] : [],
            ),
          });
          continue;
        }
        for (const assertion of fileResult.assertionResults) {
          const status = mapVitestStatus(assertion.status);
          const title = assertion.title;
          const description = vitestTestDescription(assertion);
          tests.push({
            name: assertion.fullName ?? title,
            title,
            description,
            status,
            durationMs: assertion.duration,
            failureMessages: buildFailureMessages(assertion.failureMessages),
            location: mapLocation(assertion.location),
          });
        }
      }
      return capSummarySize({
        total: data.numTotalTests ?? tests.length,
        passed: data.numPassedTests ?? tests.filter((t) => t.status === 'passed').length,
        failed: data.numFailedTests ?? tests.filter((t) => t.status === 'failed').length,
        skipped:
          data.numPendingTests ?? tests.filter((t) => t.status === 'skipped').length,
        tests,
      });
    }
  } catch {
    return null;
  }
  return null;
}

function collectPlaywrightSpecs(
  suites: PlaywrightSuite[],
  out: E2eTestCaseSummary[],
  ancestors: string[],
): void {
  for (const suite of suites) {
    const path = suite.title ? [...ancestors, suite.title] : ancestors;
    for (const spec of suite.specs ?? []) {
      const result = spec.tests?.[0]?.results?.at(-1);
      const status = mapPlaywrightStatus(result?.status ?? 'unknown');
      const description = path.length > 0 ? path.join(' \u203a ') : undefined;
      out.push({
        name: spec.title,
        title: spec.title,
        description,
        status,
        durationMs: result?.duration,
        failureMessages: buildPlaywrightFailureMessages(result),
        location: mapLocation(result?.error?.location ?? result?.errorLocation),
      });
    }
    if (suite.suites?.length) {
      collectPlaywrightSpecs(suite.suites, out, path);
    }
  }
}

function vitestTestDescription(assertion: VitestAssertionResult): string | undefined {
  if (assertion.ancestorTitles?.length) {
    return assertion.ancestorTitles.join(' \u203a ');
  }
  if (assertion.fullName && assertion.title && assertion.fullName !== assertion.title) {
    const prefix = assertion.fullName.slice(0, assertion.fullName.length - assertion.title.length).trim();
    return prefix || undefined;
  }
  return undefined;
}

function buildPlaywrightFailureMessages(
  result: PlaywrightTestResult | undefined,
): string[] | undefined {
  if (!result?.error) return undefined;
  const parts: (string | undefined)[] = [];
  const { error } = result;
  if (error.message) parts.push(error.message);
  if (error.matcherResult) {
    const mr = error.matcherResult;
    const matcherLine = [
      mr.name ? `Matcher: ${mr.name}` : null,
      mr.expected !== undefined ? `Expected: ${formatMatcherValue(mr.expected)}` : null,
      mr.actual !== undefined ? `Received: ${formatMatcherValue(mr.actual)}` : null,
      mr.message && mr.message !== error.message ? mr.message : null,
    ]
      .filter(Boolean)
      .join('\n');
    if (matcherLine) parts.push(matcherLine);
  }
  if (error.stack && error.stack !== error.message) parts.push(error.stack);
  return buildFailureMessages(parts);
}

function formatMatcherValue(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function buildFailureMessages(
  parts: (string | undefined | null)[] | undefined,
): string[] | undefined {
  if (!parts?.length) return undefined;
  const messages = parts
    .filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
    .map((p) => truncate(stripAnsi(p), MAX_FAILURE_MSG_LEN));
  return messages.length > 0 ? messages : undefined;
}

function mapLocation(
  loc: { file?: string; line?: number; column?: number } | null | undefined,
): E2eTestCaseLocation | undefined {
  if (!loc?.file) return undefined;
  return {
    file: loc.file,
    line: loc.line,
    column: loc.column,
  };
}

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen)}… [truncated]`;
}

function capSummarySize(summary: E2eRunSummary): E2eRunSummary {
  if (!summary.tests?.length) return summary;
  let serialized = JSON.stringify(summary);
  if (serialized.length <= MAX_SUMMARY_JSON_BYTES) return summary;

  const tests = [...summary.tests];
  while (tests.length > 0 && JSON.stringify({ ...summary, tests }).length > MAX_SUMMARY_JSON_BYTES) {
    const removed = tests.pop();
    if (removed?.failureMessages?.length) {
      tests.push({
        ...removed,
        failureMessages: [
          '[failure details truncated — summary size cap exceeded]',
        ],
      });
      break;
    }
  }
  return { ...summary, tests };
}

export function mapVitestStatus(
  status: string,
): E2eTestCaseSummary['status'] {
  if (status === 'pass' || status === 'passed') return 'passed';
  if (status === 'fail' || status === 'failed') return 'failed';
  if (
    status === 'skip' ||
    status === 'skipped' ||
    status === 'todo' ||
    status === 'pending'
  ) {
    return 'skipped';
  }
  if (status === 'timedOut') return 'timedOut';
  return 'failed';
}

function mapPlaywrightStatus(status: string): E2eTestCaseSummary['status'] {
  if (status === 'passed') return 'passed';
  if (status === 'skipped') return 'skipped';
  if (status === 'timedOut') return 'timedOut';
  return 'failed';
}
