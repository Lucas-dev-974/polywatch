import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import { resolveMonorepoPath } from '@polywatch/core/config/env';
import { E2eRunnerSpawnError } from './errors.js';
import type { E2eSuiteDefinition } from './suites.js';

const execFileAsync = promisify(execFile);

export function killProcessTree(pid: number): Promise<void> {
  if (process.platform === 'win32') {
    return execFileAsync('taskkill', ['/PID', String(pid), '/T', '/F']).then(
      () => undefined,
      () => undefined,
    );
  }
  return execFileAsync('kill', ['-TERM', `-${pid}`]).then(
    () => undefined,
    () => execFileAsync('kill', ['-TERM', String(pid)]).then(() => undefined, () => undefined),
  );
}

export interface SpawnNpmTestOptions {
  suite: E2eSuiteDefinition;
  resultsPath: string;
  runId: string;
}

export function spawnNpmTest({ suite, resultsPath, runId }: SpawnNpmTestOptions): ChildProcess {
  const extraArgs = [...(suite.extraArgs ?? [])];

  const spawnEnv: NodeJS.ProcessEnv = { ...process.env, ...suite.env, E2E_RUN_ID: runId };
  if (suite.id === 'playwright') {
    spawnEnv.PLAYWRIGHT_JSON_OUTPUT_NAME = `data/e2e-runs/${runId}-results.json`;
  }

  try {
    return spawn('npm', ['run', suite.script, '--', ...extraArgs], {
      cwd: resolveMonorepoPath('.'),
      env: spawnEnv,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      // Node 18+ on Windows rejects npm.cmd without a shell (spawn EINVAL).
      shell: process.platform === 'win32',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Échec du lancement npm';
    throw new E2eRunnerSpawnError(message);
  }
}

/** Pipe stdout/stderr line-by-line into appendLine; call flush() on process close. */
export function attachProcessLogPipes(
  child: ChildProcess,
  appendLine: (line: string) => void,
): { flush: () => void } {
  let stdoutRemainder = '';
  let stderrRemainder = '';

  child.stdout?.on('data', (chunk: Buffer) => {
    const text = stdoutRemainder + chunk.toString();
    const lines = text.split('\n');
    stdoutRemainder = lines.pop() ?? '';
    for (const line of lines) appendLine(line);
  });

  child.stderr?.on('data', (chunk: Buffer) => {
    const text = stderrRemainder + chunk.toString();
    const lines = text.split('\n');
    stderrRemainder = lines.pop() ?? '';
    for (const line of lines) appendLine(line);
  });

  return {
    flush: () => {
      if (stdoutRemainder) appendLine(stdoutRemainder);
      if (stderrRemainder) appendLine(stderrRemainder);
    },
  };
}
