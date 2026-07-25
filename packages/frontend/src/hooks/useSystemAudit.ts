import { createSignal, onMount, onCleanup } from 'solid-js';
import { api } from '../api';
import {
  onSystemAuditLog,
  onSystemAuditStarted,
  onSystemAuditFinished,
  connectSocket,
} from '../socket';
import type {
  AuditScriptId,
  SystemAuditLogEvent,
  SystemAuditFinishedEvent,
  SystemAuditStartedEvent,
} from '../lib/system-overview';

export function useSystemAudit() {
  const [runId, setRunId] = createSignal<string | null>(null);
  const [logs, setLogs] = createSignal<string>('');
  const [running, setRunning] = createSignal(false);
  const [finished, setFinished] = createSignal(false);
  const [exitCode, setExitCode] = createSignal<number | null>(null);
  const [error, setError] = createSignal<string | null>(null);

  async function runAudit(script: AuditScriptId, confirm?: boolean) {
    setLogs('');
    setFinished(false);
    setExitCode(null);
    setError(null);
    setRunning(true);

    try {
      const result = await api<{ runId: string }>('/system/audit', {
        method: 'POST',
        body: JSON.stringify({ script, confirm }),
      });
      setRunId(result.runId);
    } catch (err) {
      setRunning(false);
      const message = err instanceof Error ? err.message : 'Impossible de lancer l\'audit';
      setError(message);
    }
  }

  onMount(() => {
    connectSocket();

    const offLog = onSystemAuditLog((payload: SystemAuditLogEvent) => {
      const current = runId();
      if (current && payload.runId === current) {
        setLogs((prev) => (prev ? `${prev}\n${payload.line}` : payload.line));
      }
    });

    const offStarted = onSystemAuditStarted((payload: SystemAuditStartedEvent) => {
      setRunId(payload.runId);
      setRunning(true);
      setFinished(false);
      setExitCode(null);
      setError(null);
    });

    const offFinished = onSystemAuditFinished((payload: SystemAuditFinishedEvent) => {
      if (runId() === payload.runId) {
        setRunning(false);
        setFinished(true);
        setExitCode(payload.exitCode);
      }
    });

    onCleanup(() => {
      offLog();
      offStarted();
      offFinished();
    });
  });

  return { runId, logs, running, finished, exitCode, error, runAudit };
}
