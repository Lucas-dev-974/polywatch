import { io, type Socket } from 'socket.io-client';

import { getAccessToken, refreshSessionTokens } from './api';

let socket: Socket | null = null;

/**
 * Read-only reference to the current Socket.IO instance.
 * Consumers should call `connectSocket()` at least once before relying on it.
 */
export { socket };

function attachAuthRecovery(sock: Socket): void {
  sock.on('connect_error', async (err) => {
    if (err.message !== 'unauthorized') return;

    const refreshed = await refreshSessionTokens();
    if (!refreshed) return;

    const token = getAccessToken();
    if (!token) return;

    sock.auth = { token };
    sock.connect();
  });
}

/** Temps de coalescence des événements WebSocket en un refresh global. */
const GLOBAL_REFRESH_DEBOUNCE_MS = 250;

/** Abonnés au refresh global. */
const refreshListeners = new Set<() => void>();
let refreshTimeoutId: ReturnType<typeof setTimeout> | null = null;

/** Notifie tous les abonnés une seule fois après un court délai. */
function scheduleGlobalRefresh(): void {
  if (refreshTimeoutId != null) return;
  refreshTimeoutId = setTimeout(() => {
    refreshTimeoutId = null;
    for (const listener of refreshListeners) {
      try {
        listener();
      } catch {
        // Ignore listener errors to avoid breaking other subscribers.
      }
    }
  }, GLOBAL_REFRESH_DEBOUNCE_MS);
}

/**
 * Abonne un callback au refresh global. Le callback est invoqué une fois
 * après chaque rafale d'événements WebSocket (position_update, execution,
 * simulation_reset, move_detected, simulation_snapshot_created,
 * real_snapshot_created, real_period_rotated).
 * Retourne une fonction de désabonnement.
 */
export function onGlobalRefresh(callback: () => void): () => void {
  refreshListeners.add(callback);
  return () => {
    refreshListeners.delete(callback);
  };
}

function attachGlobalRefreshTriggers(sock: Socket): void {
  sock.on('position_update', () => scheduleGlobalRefresh());
  sock.on('execution', () => scheduleGlobalRefresh());
  sock.on('simulation_reset', () => scheduleGlobalRefresh());
  sock.on('move_detected', () => scheduleGlobalRefresh());
  sock.on('simulation_snapshot_created', () => scheduleGlobalRefresh());
  sock.on('real_snapshot_created', () => scheduleGlobalRefresh());
  sock.on('real_period_rotated', () => scheduleGlobalRefresh());
}

export function connectSocket(): Socket {
  if (socket?.connected) return socket;

  if (socket) {
    // The in-memory access token may have rotated since the last attempt.
    socket.auth = { token: getAccessToken() };
    socket.connect();
    return socket;
  }

  socket = io('/', {
    auth: { token: getAccessToken() },
    transports: ['websocket'],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 2_000,
    reconnectionDelayMax: 30_000,
  });

  attachAuthRecovery(socket);
  attachGlobalRefreshTriggers(socket);
  attachE2eTriggers(socket);
  attachSystemAuditTriggers(socket);
  attachCryptoAlgoMonitorTriggers(socket);
  return socket;
}

type E2eLogPayload = { runId: string; line: string; ts: number };
type E2eRunStartedPayload = { runId: string; suite: string };
type E2eRunFinishedPayload = { runId: string; status: string; summary: unknown };
type E2ePositionPayload = {
  id: string;
  runId: string;
  conditionId: string;
  marketQuestion: string | null;
  cryptoSymbol: string | null;
  interval: string | null;
  outcome: string;
  side: string;
  entryPrice: number;
  quantity: number;
  currentPrice: number | null;
  pnlPercent: number | null;
  realizedPnl: number | null;
  status: 'open' | 'closed';
  closeReason: string | null;
  openedAt: string;
  closedAt: string | null;
};
type E2ePositionUpdatePayload = {
  runId: string;
  positionId: string;
  currentPrice: number;
  pnlPercent: number;
};

const e2eLogListeners = new Set<(payload: E2eLogPayload) => void>();
const e2eRunStartedListeners = new Set<(payload: E2eRunStartedPayload) => void>();
const e2eRunFinishedListeners = new Set<(payload: E2eRunFinishedPayload) => void>();
const e2ePositionListeners = new Set<(payload: E2ePositionPayload) => void>();
const e2ePositionUpdateListeners = new Set<(payload: E2ePositionUpdatePayload) => void>();

function attachE2eTriggers(sock: Socket): void {
  sock.on('e2e_log', (payload: E2eLogPayload) => {
    for (const listener of e2eLogListeners) {
      try {
        listener(payload);
      } catch {
        // ignore
      }
    }
  });
  sock.on('e2e_run_started', (payload: E2eRunStartedPayload) => {
    for (const listener of e2eRunStartedListeners) {
      try {
        listener(payload);
      } catch {
        // ignore
      }
    }
  });
  sock.on('e2e_run_finished', (payload: E2eRunFinishedPayload) => {
    for (const listener of e2eRunFinishedListeners) {
      try {
        listener(payload);
      } catch {
        // ignore
      }
    }
  });
  sock.on('e2e_position', (payload: E2ePositionPayload) => {
    for (const listener of e2ePositionListeners) {
      try {
        listener(payload);
      } catch {
        // ignore
      }
    }
  });
  sock.on('e2e_position_update', (payload: E2ePositionUpdatePayload) => {
    for (const listener of e2ePositionUpdateListeners) {
      try {
        listener(payload);
      } catch {
        // ignore
      }
    }
  });
}

export function onE2eLog(callback: (payload: E2eLogPayload) => void): () => void {
  e2eLogListeners.add(callback);
  return () => e2eLogListeners.delete(callback);
}

export function onE2eRunStarted(callback: (payload: E2eRunStartedPayload) => void): () => void {
  e2eRunStartedListeners.add(callback);
  return () => e2eRunStartedListeners.delete(callback);
}

export function onE2eRunFinished(callback: (payload: E2eRunFinishedPayload) => void): () => void {
  e2eRunFinishedListeners.add(callback);
  return () => e2eRunFinishedListeners.delete(callback);
}

export function onE2ePosition(callback: (payload: E2ePositionPayload) => void): () => void {
  e2ePositionListeners.add(callback);
  return () => e2ePositionListeners.delete(callback);
}

export function onE2ePositionUpdate(callback: (payload: E2ePositionUpdatePayload) => void): () => void {
  e2ePositionUpdateListeners.add(callback);
  return () => e2ePositionUpdateListeners.delete(callback);
}

// ── System audit events ──────────────────────────────────────────────

type SystemAuditLogPayload = { runId: string; line: string; timestamp: number };
type SystemAuditStartedPayload = { runId: string; script: string };
type SystemAuditFinishedPayload = { runId: string; exitCode: number; elapsedMs: number };

const systemAuditLogListeners = new Set<(payload: SystemAuditLogPayload) => void>();
const systemAuditStartedListeners = new Set<(payload: SystemAuditStartedPayload) => void>();
const systemAuditFinishedListeners = new Set<(payload: SystemAuditFinishedPayload) => void>();

function attachSystemAuditTriggers(sock: Socket): void {
  sock.on('system:audit:log', (payload: SystemAuditLogPayload) => {
    for (const listener of systemAuditLogListeners) {
      try { listener(payload); } catch { /* ignore */ }
    }
  });
  sock.on('system:audit:started', (payload: SystemAuditStartedPayload) => {
    for (const listener of systemAuditStartedListeners) {
      try { listener(payload); } catch { /* ignore */ }
    }
  });
  sock.on('system:audit:finished', (payload: SystemAuditFinishedPayload) => {
    for (const listener of systemAuditFinishedListeners) {
      try { listener(payload); } catch { /* ignore */ }
    }
  });
}

export function onSystemAuditLog(callback: (payload: SystemAuditLogPayload) => void): () => void {
  systemAuditLogListeners.add(callback);
  return () => systemAuditLogListeners.delete(callback);
}

export function onSystemAuditStarted(callback: (payload: SystemAuditStartedPayload) => void): () => void {
  systemAuditStartedListeners.add(callback);
  return () => systemAuditStartedListeners.delete(callback);
}

export function onSystemAuditFinished(callback: (payload: SystemAuditFinishedPayload) => void): () => void {
  systemAuditFinishedListeners.add(callback);
  return () => systemAuditFinishedListeners.delete(callback);
}

// ── Crypto-algo monitor events ───────────────────────────────────────

type CryptoAlgoMonitorLogPayload = { runId: string; line: string; timestamp: number };
type CryptoAlgoMonitorSnapshotPayload = { runId: string; snapshot: Record<string, unknown>; timestamp: number };
type CryptoAlgoMonitorFinishedPayload = { runId: string; exitCode: number; elapsedMs: number };

const cryptoAlgoMonitorLogListeners = new Set<(payload: CryptoAlgoMonitorLogPayload) => void>();
const cryptoAlgoMonitorSnapshotListeners = new Set<(payload: CryptoAlgoMonitorSnapshotPayload) => void>();
const cryptoAlgoMonitorFinishedListeners = new Set<(payload: CryptoAlgoMonitorFinishedPayload) => void>();

function attachCryptoAlgoMonitorTriggers(sock: Socket): void {
  sock.on('crypto-algo-monitor:log', (payload: CryptoAlgoMonitorLogPayload) => {
    for (const listener of cryptoAlgoMonitorLogListeners) {
      try { listener(payload); } catch { /* ignore */ }
    }
  });
  sock.on('crypto-algo-monitor:snapshot', (payload: CryptoAlgoMonitorSnapshotPayload) => {
    for (const listener of cryptoAlgoMonitorSnapshotListeners) {
      try { listener(payload); } catch { /* ignore */ }
    }
  });
  sock.on('crypto-algo-monitor:finished', (payload: CryptoAlgoMonitorFinishedPayload) => {
    for (const listener of cryptoAlgoMonitorFinishedListeners) {
      try { listener(payload); } catch { /* ignore */ }
    }
  });
}

export function onCryptoAlgoMonitorLog(callback: (payload: CryptoAlgoMonitorLogPayload) => void): () => void {
  cryptoAlgoMonitorLogListeners.add(callback);
  return () => cryptoAlgoMonitorLogListeners.delete(callback);
}

export function onCryptoAlgoMonitorSnapshot(callback: (payload: CryptoAlgoMonitorSnapshotPayload) => void): () => void {
  cryptoAlgoMonitorSnapshotListeners.add(callback);
  return () => cryptoAlgoMonitorSnapshotListeners.delete(callback);
}

export function onCryptoAlgoMonitorFinished(callback: (payload: CryptoAlgoMonitorFinishedPayload) => void): () => void {
  cryptoAlgoMonitorFinishedListeners.add(callback);
  return () => cryptoAlgoMonitorFinishedListeners.delete(callback);
}

export function disconnectSocket(): void {
  if (refreshTimeoutId != null) {
    clearTimeout(refreshTimeoutId);
    refreshTimeoutId = null;
  }
  socket?.disconnect();
  socket = null;
}
