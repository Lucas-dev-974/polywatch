export interface ProcessStatus {
  name: string;
  alive: boolean;
  lastSeenAt: string | null;
  uptimeSeconds: number | null;
  pid: number | null;
  extra?: Record<string, unknown>;
}

export interface RedisQueueStatus {
  name: string;
  depth: number;
  processing: number;
  dead?: number;
}

export interface ServiceHealth {
  redis: 'ok' | 'down';
  postgres: 'ok' | 'down';
  backend: 'ok' | 'down';
}

export interface SystemOverviewResponse {
  generatedAt: string;
  backend: {
    pid: number;
    uptimeSeconds: number;
    status: 'ok' | 'degraded';
  };
  services: ServiceHealth;
  processes: ProcessStatus[];
  queues: RedisQueueStatus[];
}

export type AuditScriptId =
  | 'redis-queues'
  | 'redis-clients'
  | 'worker-liveness'
  | 'pending-algo'
  | 'recent-outcomes'
  | 'flush-redis-queues';

export interface SystemAuditRequest {
  script: AuditScriptId;
  confirm?: boolean;
}

export interface SystemAuditLogEvent {
  runId: string;
  line: string;
  timestamp: number;
}

export interface SystemAuditFinishedEvent {
  runId: string;
  exitCode: number;
  elapsedMs: number;
}

export interface SystemAuditStartedEvent {
  runId: string;
  script: string;
}

// ── Crypto-Algo Monitor types ─────────────────────────────────────────

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
    slBidPoints: number | null;
    tpBidPoints: number | null;
    trailingBidPoints: number | null;
    trailingActivationBidPoints: number | null;
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

export interface CryptoAlgoMonitorLogEvent {
  runId: string;
  line: string;
  timestamp: number;
}

export interface CryptoAlgoMonitorSnapshotEvent {
  runId: string;
  snapshot: CryptoAlgoMonitorSnapshot;
  timestamp: number;
}

export interface CryptoAlgoMonitorFinishedEvent {
  runId: string;
  exitCode: number;
  elapsedMs: number;
}

export interface CryptoAlgoMonitorRunResponse {
  runId: string;
  startedAt: string;
  durationHours: number;
  intervalSeconds: number;
  finished: boolean;
  exitCode: number | null;
  error: string | null;
  logs: string[];
  latestSnapshot: CryptoAlgoMonitorSnapshot | null;
}

export interface CryptoAlgoMonitorStartRequest {
  durationHours?: number;
  intervalSeconds?: number;
}

