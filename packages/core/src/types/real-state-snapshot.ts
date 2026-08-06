import type { EnrichedCopiedPosition } from '../services/copied-position-presenter.js';
import type { Execution } from '../entities/Execution.js';
import type { RealRiskConfigSnapshot } from '../risk/sim-mode-fields.js';
import type { ExitAttemptEventDto } from '../services/exit-attempt-event.service.js';
import type {
  RealSnapshotDecisionSummary,
  RealSnapshotMoveEvent,
} from '../real/snapshot-decision-collector.js';

export type RealStateSnapshotSource = 'manual' | 'auto' | 'rotate' | 'config_change';

export interface RealSnapshotTrader {
  watchlistId: number | null;
  traderAddress: string;
  nickname: string | null;
  active: boolean | null;
  realEnabled: boolean | null;
  inWatchlistReal: boolean;
  positionCount: number;
  openPositionCount: number;
  closedPositionCount: number;
  realizedPnl: number;
  unrealizedPnl: number;
}

export interface RealStateSnapshotSummary {
  id: number;
  createdAt: string;
  label: string | null;
  source: RealStateSnapshotSource;
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
  RealSnapshotDecisionSummary,
  RealSnapshotMoveEvent,
} from '../real/snapshot-decision-collector.js';

export interface RealStateSnapshotDetail extends RealStateSnapshotSummary {
  config: RealRiskConfigSnapshot | null;
  traders: RealSnapshotTrader[];
  positions: EnrichedCopiedPosition[];
  executions: Execution[];
  exitAttempts: ExitAttemptEventDto[];
  moveEvents: RealSnapshotMoveEvent[];
  decisionSummary: RealSnapshotDecisionSummary | null;
}

export interface CreateRealStateSnapshotOptions {
  label?: string | null;
  source: RealStateSnapshotSource;
  /** Observed wallet cash at snapshot time (required for real mode). */
  observedCash: number;
  /** When true, skip persisting if no positions and no executions. */
  skipIfEmpty?: boolean;
}

export interface ListRealSnapshotsOptions {
  limit?: number;
  offset?: number;
  source?: RealStateSnapshotSource;
  sessionId?: number;
  /** Case-insensitive substring match on label. */
  label?: string;
  /** ISO date (inclusive start of day). */
  from?: string;
  /** ISO date (inclusive end of day). */
  to?: string;
}

export { safeParseJson } from '../lib/safe-parse-json.js';
