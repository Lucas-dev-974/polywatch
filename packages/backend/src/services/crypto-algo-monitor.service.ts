import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';
import {
  emitCryptoAlgoMonitorFinished,
  emitCryptoAlgoMonitorLog,
  emitCryptoAlgoMonitorSnapshot,
} from '../websocket.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CRYPTO_ALGO_DIR = path.resolve(__dirname, '../../crypto-algo');
const MONITOR_SCRIPT = 'src/scripts/monitor.ts';
const MAX_MONITOR_DURATION_HOURS = 48;
const DEFAULT_MONITOR_DURATION_HOURS = 24;
const DEFAULT_MONITOR_INTERVAL_SECONDS = 60;

export interface CryptoAlgoMonitorSnapshot {
  ts: string;
  runtimeStatus: Record<string, unknown> | null;
  signals: {
    totalConditions: number;
    wsHealthyRatio: number | null;
    byAbstainReason: Record<string, number>;
    bySignalOutcome: Record<string, number>;
    byInterval: Record<string, number>;
    avgConfidence: number | null;
  };
  positions: {
    openCount: number;
    closingCount: number;
    openExposureUsd: number;
    openUnrealizedPnl: number;
    byIntervalMode: Record<string, { count: number; realizedPnl: number; unrealizedPnl: number }>;
  };
  closed: {
    count: number;
    byCloseReason: Record<string, { count: number; pnl: number }>;
    winRate: number;
    avgPnl: number;
  };
  exitProblems: Array<{
    conditionId: string;
    interval: string | null;
    mode: string;
    outcome: string;
    blockedReason: string | null;
    blockedCloseReason: string | null;
    blockedCount: number;
    failedAttempts: number;
    question: string | null;
  }>;
  openPositions: Array<{
    conditionId: string;
    interval: string | null;
    mode: string;
    outcome: string;
    entryPrice: number | null;
    entryBidVwap: number | null;
    executableBidVwap: number | null;
    lastCloseableBidVwap: number | null;
    unrealizedPnl: number | null;
    peakClosurePnlPercent: number | null;
    slPercent: number | null;
    tpPercent: number | null;
    trailingPercent: number | null;
    trailingActivationPercent: number | null;
    liquidityStatus: string;
    reason: string;
    openedAt: string;
    endDate: string | null;
    question: string | null;
  }>;
  marketActivity: Array<{
    conditionId: string;
    interval: string | null;
    tickCount: number;
    signalVariety: number;
    abstainVariety: number;
    lastTickAt: string;
    upMin: number | null;
    upMax: number | null;
    avgUpSpreadPct: number | null;
    wsHealthyRatio: number | null;
  }>;
  runSeconds: number;
}

export interface ActiveMonitorRun {
  runId: string;
  startedAt: string;
  durationHours: number;
  intervalSeconds: number;
  child: ChildProcess;
  logs: string[];
  latestSnapshot: CryptoAlgoMonitorSnapshot | null;
  finished: boolean;
  exitCode: number | null;
  error: string | null;
}

export interface MonitorRunConfig {
  durationHours?: number;
  intervalSeconds?: number;
}

export interface MonitorStartResult {
  runId: string;
  startedAt: string;
  durationHours: number;
  intervalSeconds: number;
}

interface MonitorStdioLine {
  kind: 'snapshot' | 'log' | 'heartbeat';
  payload?: CryptoAlgoMonitorSnapshot;
  level?: 'info' | 'warn' | 'error';
  message?: string;
}

let activeRun: ActiveMonitorRun | null = null;

export function getActiveCryptoAlgoMonitorRun(): ActiveMonitorRun | null {
  return activeRun;
}

/** Kill all running monitor processes. Called on backend shutdown. */
export function killAllCryptoAlgoMonitorProcesses(): void {
  if (activeRun?.child && !activeRun.child.killed) {
    try {
      activeRun.child.kill();
    } catch {
      // already dead
    }
  }
}

function sanitizeDurationHours(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_MONITOR_DURATION_HOURS;
  return Math.min(n, MAX_MONITOR_DURATION_HOURS);
}

function sanitizeIntervalSeconds(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n < 10) return DEFAULT_MONITOR_INTERVAL_SECONDS;
  return n;
}

function appendLog(run: ActiveMonitorRun, line: string): void {
  run.logs.push(line);
  // Keep last 2000 lines to avoid unbounded memory growth
  if (run.logs.length > 2000) {
    run.logs = run.logs.slice(run.logs.length - 2000);
  }
  emitCryptoAlgoMonitorLog({ runId: run.runId, line, timestamp: Date.now() });
}

function tryParseStdioLine(line: string): MonitorStdioLine | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  // Our monitor script emits structured lines prefixed with [crypto-algo-monitor]
  // and snapshot JSON lines prefixed with [snapshot]
  if (trimmed.startsWith('[snapshot]')) {
    try {
      const json = trimmed.slice('[snapshot]'.length).trim();
      const payload = JSON.parse(json) as CryptoAlgoMonitorSnapshot;
      return { kind: 'snapshot', payload };
    } catch {
      return { kind: 'log', level: 'warn', message: `Invalid snapshot line: ${trimmed}` };
    }
  }

  if (trimmed.startsWith('[heartbeat]')) {
    return { kind: 'heartbeat', message: trimmed.slice('[heartbeat]'.length).trim() };
  }

  return { kind: 'log', message: trimmed };
}

/**
 * Start the crypto-algo monitor child process.
 * Only one run is allowed at a time.
 */
export async function startCryptoAlgoMonitor(
  config: MonitorRunConfig = {},
): Promise<MonitorStartResult> {
  if (activeRun && !activeRun.finished) {
    throw new Error('Un run de monitoring crypto-algo est déjà en cours');
  }

  // Clean up any finished previous run
  activeRun = null;

  const durationHours = sanitizeDurationHours(config.durationHours);
  const intervalSeconds = sanitizeIntervalSeconds(config.intervalSeconds);
  const runId = randomUUID();
  const startedAt = new Date().toISOString();

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    CRYPTO_MONITOR_RUN_ID: runId,
    CRYPTO_MONITOR_DURATION_HOURS: String(durationHours),
    CRYPTO_MONITOR_INTERVAL_SECONDS: String(intervalSeconds),
    CRYPTO_MONITOR_OUTPUT_DIR: path.resolve(CRYPTO_ALGO_DIR, 'monitoring'),
  };

  // DATABASE_URL and REDIS_URL are already in process.env; pass them explicitly
  // so the child inherits them even in restricted environments.
  if (process.env.DATABASE_URL) {
    env.DATABASE_URL = process.env.DATABASE_URL;
  }
  if (process.env.REDIS_URL) {
    env.REDIS_URL = process.env.REDIS_URL;
  }

  // Resolve the tsx CLI path relative to the monorepo root, avoiding the
  // need for npx/shell which fails with ENOENT on Windows/MSYS environments.
  // CRYPTO_ALGO_DIR = packages/crypto-algo  →  monorepo root = ../../
  const monorepoRoot = path.resolve(CRYPTO_ALGO_DIR, '..', '..');
  const tsxCliPath = path.resolve(monorepoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const monitorScriptPath = path.resolve(CRYPTO_ALGO_DIR, MONITOR_SCRIPT);

  const child = spawn(process.execPath, [tsxCliPath, monitorScriptPath], {
    cwd: CRYPTO_ALGO_DIR,
    stdio: ['ignore', 'pipe', 'pipe'],
    env,
  });

  const run: ActiveMonitorRun = {
    runId,
    startedAt,
    durationHours,
    intervalSeconds,
    child,
    logs: [],
    latestSnapshot: null,
    finished: false,
    exitCode: null,
    error: null,
  };

  activeRun = run;
  emitCryptoAlgoMonitorLog({
    runId,
    line: `[start] crypto-algo monitor runId=${runId} duration=${durationHours}h interval=${intervalSeconds}s`,
    timestamp: Date.now(),
  });

  const startTime = Date.now();

  child.stdout?.on('data', (chunk: Buffer) => {
    const lines = chunk.toString().split('\n');
    for (const raw of lines) {
      const parsed = tryParseStdioLine(raw);
      if (!parsed) continue;

      if (parsed.kind === 'snapshot' && parsed.payload) {
        run.latestSnapshot = parsed.payload;
        emitCryptoAlgoMonitorSnapshot({
          runId,
          snapshot: parsed.payload as unknown as Record<string, unknown>,
          timestamp: Date.now(),
        });
      } else if (parsed.kind === 'heartbeat' && parsed.message) {
        appendLog(run, `[heartbeat] ${parsed.message}`);
      } else {
        appendLog(run, parsed.message ?? raw);
      }
    }
  });

  child.stderr?.on('data', (chunk: Buffer) => {
    const lines = chunk.toString().split('\n');
    for (const raw of lines) {
      const line = raw.trim();
      if (line) appendLog(run, `[stderr] ${line}`);
    }
  });

  child.on('exit', (code) => {
    run.finished = true;
    run.exitCode = code ?? -1;
    emitCryptoAlgoMonitorFinished({
      runId,
      exitCode: run.exitCode,
      elapsedMs: Date.now() - startTime,
    });
    appendLog(run, `[finished] exitCode=${run.exitCode}`);
  });

  child.on('error', (err) => {
    run.error = err.message;
    appendLog(run, `[error] ${err.message}`);
    if (!run.finished) {
      run.finished = true;
      run.exitCode = -1;
      emitCryptoAlgoMonitorFinished({
        runId,
        exitCode: -1,
        elapsedMs: Date.now() - startTime,
      });
    }
  });

  // Safety net: ensure the child is killed if it exceeds its planned duration + 5 min buffer
  const maxRuntimeMs = durationHours * 60 * 60 * 1000 + 5 * 60 * 1000;
  setTimeout(() => {
    if (activeRun?.runId === runId && !activeRun.finished && !activeRun.child.killed) {
      appendLog(run, '[timeout] killing monitor after max runtime exceeded');
      try {
        activeRun.child.kill();
      } catch {
        // ignore
      }
    }
  }, maxRuntimeMs).unref();

  return {
    runId,
    startedAt,
    durationHours,
    intervalSeconds,
  };
}

/**
 * Stop the active monitor run by killing its child process.
 */
export async function stopCryptoAlgoMonitor(runId: string): Promise<void> {
  if (!activeRun || activeRun.runId !== runId) {
    throw new Error('Run non trouvé ou déjà terminé');
  }

  if (activeRun.finished || activeRun.child.killed) {
    return;
  }

  appendLog(activeRun, '[stop] arrêt demandé par l\'utilisateur');
  try {
    activeRun.child.kill();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    appendLog(activeRun, `[stop-error] ${message}`);
    throw err;
  }
}

/**
 * Read the latest snapshot from disk as a fallback when joining an already running run.
 * Uses atomic read with retry to avoid partial JSON reads.
 */
export async function readLatestSnapshotFromDisk(runId: string): Promise<CryptoAlgoMonitorSnapshot | null> {
  const filePath = path.resolve(CRYPTO_ALGO_DIR, 'monitoring', `crypto-algo-monitor-${runId}.json`);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const raw = await fs.readFile(filePath, 'utf8');
      const parsed = JSON.parse(raw) as { latest?: CryptoAlgoMonitorSnapshot };
      return parsed.latest ?? null;
    } catch (err) {
      if (attempt === 2) return null;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  return null;
}
