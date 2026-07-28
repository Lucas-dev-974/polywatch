import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import type { PnlTick, SimulationSnapshot, MarketTick, MarketPercentUpdate, AlgoChartTickUpdate } from '@polywatch/core';
import { verifyAccessToken } from './auth/jwt.js';
import { config } from './config.js';

let io: Server | null = null;

export function initWebSocket(server: HttpServer): Server {
  io = new Server(server, {
    cors: { origin: config.corsOrigins, methods: ['GET', 'POST'] },
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) return next(new Error('unauthorized'));
    try {
      verifyAccessToken(token);
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    socket.join('positions');
    socket.join('executions');
    socket.join('alerts');
    socket.join('markets');
    socket.join('e2e-runs');
  });

  return io;
}

export function emitPositionUpdate(data: unknown): void {
  io?.to('positions').emit('position_update', data);
}

export function emitExecution(data: unknown): void {
  io?.to('executions').emit('execution', data);
}

export function emitAlert(data: unknown): void {
  io?.to('alerts').emit('alert', data);
}

export function emitPnlTicks(ticks: PnlTick[]): void {
  for (const tick of ticks) {
    io?.to('positions').emit('pnl_tick', tick);
  }
}

export function emitMarketTicks(ticks: MarketTick[]): void {
  for (const tick of ticks) {
    io?.to('positions').emit('market_tick', tick);
  }
}

export function emitMarketPercentUpdates(updates: MarketPercentUpdate[]): void {
  if (!updates.length) return;
  io?.to('markets').emit('market_pct_update', updates);
}

export function emitAlgoChartTick(tick: AlgoChartTickUpdate): void {
  io?.to('markets').emit('algo_chart_tick', tick);
}

export function emitMoveDetected(data: unknown): void {
  io?.to('positions').emit('move_detected', data);
}

export function emitSimulationReset(): void {
  io?.to('positions').emit('simulation_reset');
  io?.to('executions').emit('simulation_reset');
}

export function emitSimulationSnapshotCreated(): void {
  io?.to('positions').emit('simulation_snapshot_created');
}

export function emitRealSnapshotCreated(): void {
  io?.to('positions').emit('real_snapshot_created');
}

export function emitRealPeriodRotated(): void {
  io?.to('positions').emit('real_period_rotated');
  io?.to('executions').emit('real_period_rotated');
}

export function emitSimulationBalance(payload: SimulationSnapshot & { algoKind: string }): void {
  io?.to('positions').emit('simulation_balance', payload);
}

export function emitAlgoMarketsChanged(): void {
  io?.to('markets').emit('algo_markets_changed');
}

export function emitE2ePosition(data: unknown): void {
  io?.to('e2e-runs').emit('e2e_position', data);
}

// ── System audit events ──────────────────────────────────────────────

export function emitSystemAuditStarted(data: { runId: string; script: string }): void {
  io?.emit('system:audit:started', data);
}

export function emitSystemAuditLog(data: { runId: string; line: string; timestamp: number }): void {
  io?.emit('system:audit:log', data);
}

export function emitSystemAuditFinished(data: { runId: string; exitCode: number; elapsedMs: number }): void {
  io?.emit('system:audit:finished', data);
}

export function emitE2ePositionUpdate(data: unknown): void {
  io?.to('e2e-runs').emit('e2e_position_update', data);
}

export function emitE2eLog(data: { runId: string; line: string; ts: number }): void {
  io?.to('e2e-runs').emit('e2e_log', data);
}

export function emitE2eRunStarted(data: { runId: string; suite: string }): void {
  io?.to('e2e-runs').emit('e2e_run_started', data);
}

export function emitE2eRunFinished(data: {
  runId: string;
  status: string;
  summary: unknown;
}): void {
  io?.to('e2e-runs').emit('e2e_run_finished', data);
}

// ── Crypto-algo monitor events ───────────────────────────────────────

export interface CryptoAlgoMonitorSnapshotPayload {
  runId: string;
  snapshot: Record<string, unknown>;
  timestamp: number;
}

export function emitCryptoAlgoMonitorLog(data: { runId: string; line: string; timestamp: number }): void {
  io?.emit('crypto-algo-monitor:log', data);
}

export function emitCryptoAlgoMonitorSnapshot(data: CryptoAlgoMonitorSnapshotPayload): void {
  io?.emit('crypto-algo-monitor:snapshot', data);
}

export function emitCryptoAlgoMonitorFinished(data: { runId: string; exitCode: number; elapsedMs: number }): void {
  io?.emit('crypto-algo-monitor:finished', data);
}
