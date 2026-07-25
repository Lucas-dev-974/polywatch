import type { EnrichedCopiedPosition } from '../services/copied-position-presenter.js';
import type { Execution } from '../entities/Execution.js';
import type { SimRiskConfigSnapshot } from '../risk/sim-mode-fields.js';
import type { ExitAttemptEventDto } from '../services/exit-attempt-event.service.js';
import type {
  SimSnapshotDecisionSummary,
  SimSnapshotMoveEvent,
} from '../simulation/snapshot-decision-collector.js';

export type SimStateSnapshotSource = 'manual' | 'reset' | 'auto' | 'config_change';

export interface SimSnapshotTrader {
  watchlistId: number | null;
  traderAddress: string;
  nickname: string | null;
  active: boolean | null;
  simEnabled: boolean | null;
  inWatchlistSim: boolean;
  positionCount: number;
  openPositionCount: number;
  closedPositionCount: number;
  realizedPnl: number;
  unrealizedPnl: number;
}

export interface SimStateSnapshotSummary {
  id: number;
  createdAt: string;
  label: string | null;
  source: SimStateSnapshotSource;
  sessionId: number | null;
  sessionLabel: string | null;
  amount: number;
  token: string;
  positionsValue: number;
  equity: number;
  openPnlSum: number;
  closedPnlSum: number;
  baselineCapital: number;
  positionCount: number;
  openPositionCount: number;
  closedPositionCount: number;
  executionCount: number;
  traderCount: number;
  tradersLabel: string;
  sessionPnl: number;
}

export type {
  SimSnapshotDecisionSummary,
  SimSnapshotMoveEvent,
} from '../simulation/snapshot-decision-collector.js';

export interface SimStateSnapshotDetail extends SimStateSnapshotSummary {
  config: SimRiskConfigSnapshot | null;
  traders: SimSnapshotTrader[];
  positions: EnrichedCopiedPosition[];
  executions: Execution[];
  exitAttempts: ExitAttemptEventDto[];
  moveEvents: SimSnapshotMoveEvent[];
  decisionSummary: SimSnapshotDecisionSummary | null;
}

export interface CreateSimStateSnapshotOptions {
  label?: string | null;
  source: SimStateSnapshotSource;
  /** When true, skip persisting if no positions and no executions. */
  skipIfEmpty?: boolean;
}

export interface ListSimSnapshotsOptions {
  limit?: number;
  offset?: number;
  source?: SimStateSnapshotSource;
  sessionId?: number;
  /** Case-insensitive substring match on label. */
  label?: string;
  /** ISO date (inclusive start of day). */
  from?: string;
  /** ISO date (inclusive end of day). */
  to?: string;
}

/** Parse JSON safely, returning a typed fallback on error. */
export function safeParseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
