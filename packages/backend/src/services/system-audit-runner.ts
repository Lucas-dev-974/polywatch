import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { emitSystemAuditLog, emitSystemAuditStarted, emitSystemAuditFinished } from '../websocket.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// tools/ est à la racine du monorepo, ../../tools/ depuis packages/backend/src/services/
const TOOLS_DIR = path.resolve(__dirname, '../../tools');

export type AuditScriptId =
  | 'redis-queues'
  | 'redis-clients'
  | 'worker-liveness'
  | 'pending-algo'
  | 'recent-outcomes'
  | 'flush-redis-queues';

interface AuditScriptDef {
  filename: string;
  args: string[];
  dangerous: boolean;
}

const ALLOWED_AUDIT_SCRIPTS: Record<AuditScriptId, AuditScriptDef> = {
  'redis-queues': { filename: '_audit-redis-queues.ts', args: [], dangerous: false },
  'redis-clients': { filename: '_audit-redis-clients.ts', args: [], dangerous: false },
  'worker-liveness': { filename: '_audit-worker-liveness.ts', args: [], dangerous: false },
  'pending-algo': { filename: '_audit-pending-algo.ts', args: [], dangerous: false },
  'recent-outcomes': { filename: '_audit-recent-outcomes.ts', args: [], dangerous: false },
  'flush-redis-queues': { filename: 'flush-redis-queues.ts', args: ['--confirm', '--release-reservations'], dangerous: true },
};

export function isValidAuditScriptId(value: string): value is AuditScriptId {
  return value in ALLOWED_AUDIT_SCRIPTS;
}

export function isDangerousScript(script: AuditScriptId): boolean {
  return ALLOWED_AUDIT_SCRIPTS[script].dangerous;
}

export interface ActiveAuditRun {
  runId: string;
  script: AuditScriptId;
  child: ChildProcess;
}

/**
 * Verrou par script : empêche le lancement simultané du même audit.
 * Garantit qu'un script dangereux (purge) ne peut pas être exécuté deux fois.
 */
const activeRuns = new Map<AuditScriptId, ActiveAuditRun>();

/** Retourne l'audit en cours pour un script, ou undefined si libre. */
export function getActiveRun(script: AuditScriptId): ActiveAuditRun | undefined {
  return activeRuns.get(script);
}

/** Tue tous les processus enfants encore en vie. Appelé au shutdown du backend. */
export function killAllAuditProcesses(): void {
  for (const [script, run] of activeRuns) {
    const pid = run.child.pid;
    if (pid != null) {
      try {
        run.child.kill();
      } catch {
        // déjà mort
      }
    }
    activeRuns.delete(script);
  }
}

export interface SystemAuditResult {
  runId: string;
}

/**
 * Lance un script d'audit en arrière-plan.
 * Les logs sont streamés via WebSocket (system:audit:log).
 * À la fin, un événement system:audit:finished est émis.
 */
export function runAuditScript(script: AuditScriptId): SystemAuditResult {
  const def = ALLOWED_AUDIT_SCRIPTS[script];
  const scriptPath = path.resolve(TOOLS_DIR, def.filename);
  const runId = randomUUID();

  const child = spawn('npx', ['tsx', scriptPath, ...def.args], {
    cwd: TOOLS_DIR,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
  });

  const startTime = Date.now();
  const run: ActiveAuditRun = { runId, script, child };
  activeRuns.set(script, run);

  emitSystemAuditStarted({ runId, script });

  const appendLine = (line: string) => {
    emitSystemAuditLog({ runId, line, timestamp: Date.now() });
  };

  child.stdout?.on('data', (chunk: Buffer) => {
    const lines = chunk.toString().split('\n');
    for (const line of lines) {
      if (line) appendLine(line);
    }
  });

  child.stderr?.on('data', (chunk: Buffer) => {
    const lines = chunk.toString().split('\n');
    for (const line of lines) {
      if (line) appendLine(line);
    }
  });

  child.on('exit', (exitCode) => {
    activeRuns.delete(script);
    emitSystemAuditFinished({
      runId,
      exitCode: exitCode ?? -1,
      elapsedMs: Date.now() - startTime,
    });
  });

  child.on('error', () => {
    activeRuns.delete(script);
    emitSystemAuditFinished({
      runId,
      exitCode: -1,
      elapsedMs: Date.now() - startTime,
    });
  });

  return { runId };
}
