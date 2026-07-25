import { createSignal, onMount, onCleanup, createEffect, untrack } from 'solid-js';
import { api } from '../api';
import {
  onCryptoAlgoMonitorLog,
  onCryptoAlgoMonitorSnapshot,
  onCryptoAlgoMonitorFinished,
  connectSocket,
} from '../socket';
import type {
  CryptoAlgoMonitorFinishedEvent,
  CryptoAlgoMonitorLogEvent,
  CryptoAlgoMonitorRunResponse,
  CryptoAlgoMonitorSnapshot,
  CryptoAlgoMonitorSnapshotEvent,
  CryptoAlgoMonitorStartRequest,
} from '../lib/system-overview';

const STORAGE_KEY = 'polywatch_crypto_algo_monitor_run_id';

function readStoredRunId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStoredRunId(id: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (id) localStorage.setItem(STORAGE_KEY, id);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function useCryptoAlgoMonitor() {
  const [runId, setRunId] = createSignal<string | null>(readStoredRunId());
  const [running, setRunning] = createSignal(false);
  const [finished, setFinished] = createSignal(false);
  const [exitCode, setExitCode] = createSignal<number | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [logs, setLogs] = createSignal<string>('');
  const [latestSnapshot, setLatestSnapshot] = createSignal<CryptoAlgoMonitorSnapshot | null>(null);
  const [history, setHistory] = createSignal<CryptoAlgoMonitorSnapshot[]>([]);

  function setRunIdWithStorage(id: string | null): void {
    setRunId(id);
    writeStoredRunId(id);
  }

  function appendLog(line: string): void {
    setLogs((prev) => {
      const next = prev ? `${prev}\n${line}` : line;
      return next.length > 80_000 ? next.slice(-80_000) : next;
    });
  }

  async function start(config: CryptoAlgoMonitorStartRequest = {}) {
    setLogs('');
    setFinished(false);
    setExitCode(null);
    setError(null);
    setLatestSnapshot(null);
    setHistory([]);
    setRunning(true);

    try {
      const result = await api<{ runId: string; startedAt: string; durationHours: number; intervalSeconds: number }>(
        '/system/crypto-algo-monitor',
        {
          method: 'POST',
          body: JSON.stringify(config),
        }
      );
      setRunIdWithStorage(result.runId);
      appendLog(`[start] runId=${result.runId} duration=${result.durationHours}h interval=${result.intervalSeconds}s`);
    } catch (err) {
      setRunning(false);
      const message = err instanceof Error ? err.message : 'Impossible de lancer le monitor';
      setError(message);
      appendLog(`[error] ${message}`);
    }
  }

  async function stop() {
    const id = runId();
    if (!id) return;
    try {
      await api<void>(`/system/crypto-algo-monitor/${id}/stop`, { method: 'POST' });
      appendLog('[stop] arrêt demandé');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Impossible d\'arrêter le monitor';
      setError(message);
      appendLog(`[stop-error] ${message}`);
    }
  }

  async function refreshStatus() {
    const id = runId();
    if (!id) return;
    try {
      const data = await api<CryptoAlgoMonitorRunResponse>(`/system/crypto-algo-monitor/${id}`);
      setRunning(!data.finished);
      setFinished(data.finished);
      setExitCode(data.exitCode);
      setError(data.error);
      if (data.latestSnapshot) {
        setLatestSnapshot(data.latestSnapshot);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Impossible de récupérer le statut';
      appendLog(`[refresh-error] ${message}`);
    }
  }

  onMount(() => {
    connectSocket();

    // ── Recover active run after page reload ──────────────────────────
    // The backend tracks a single active monitor process. On reload, the
    // in-memory runId is lost — fetch the active run to restore state so
    // the dashboard keeps showing live data instead of resetting.
    void (async () => {
      try {
        const data = await api<CryptoAlgoMonitorRunResponse | null>(
          '/system/crypto-algo-monitor',
          {},
          false,
          0,
        );
        if (data && data.runId) {
          setRunIdWithStorage(data.runId);
          setRunning(!data.finished);
          setFinished(data.finished);
          setExitCode(data.exitCode);
          setError(data.error);
          if (data.logs?.length > 0) {
            setLogs(data.logs.join('\n'));
          }
          if (data.latestSnapshot) {
            setLatestSnapshot(data.latestSnapshot);
          }
        }
      } catch {
        // 204 (no active run) or network error — silently ignore.
      }
    })();

    const offLog = onCryptoAlgoMonitorLog((payload: CryptoAlgoMonitorLogEvent) => {
      if (runId() === payload.runId) {
        appendLog(payload.line);
      }
    });

    const offSnapshot = onCryptoAlgoMonitorSnapshot((payload: CryptoAlgoMonitorSnapshotEvent) => {
      if (runId() === payload.runId) {
        const snapshot = payload.snapshot as CryptoAlgoMonitorSnapshot;
        setLatestSnapshot(snapshot);
        setHistory((prev) => {
          const next = [...prev, snapshot];
          return next.length > 120 ? next.slice(-120) : next;
        });
      }
    });

    const offFinished = onCryptoAlgoMonitorFinished((payload: CryptoAlgoMonitorFinishedEvent) => {
      if (runId() === payload.runId) {
        setRunning(false);
        setFinished(true);
        setExitCode(payload.exitCode);
        setRunIdWithStorage(null);
        appendLog(`[finished] exitCode=${payload.exitCode}`);
      }
    });

    onCleanup(() => {
      offLog();
      offSnapshot();
      offFinished();
    });
  });

  // Auto-refresh REST status while running, in case WebSocket misses an event.
  createEffect(() => {
    if (!running() || finished()) return;
    const id = untrack(runId);
    if (!id) return;

    const interval = setInterval(() => {
      void refreshStatus();
    }, 10_000);

    onCleanup(() => clearInterval(interval));
  });

  return {
    runId,
    running,
    finished,
    exitCode,
    error,
    logs,
    latestSnapshot,
    history,
    start,
    stop,
    refreshStatus,
  };
}
