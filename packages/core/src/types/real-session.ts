import type { RealSessionStatus } from '../entities/RealSession.js';
import type { RealArchiveSummary } from './real-session-archive.js';
import type { RealRiskConfigSnapshot } from '../risk/sim-mode-fields.js';

export type { RealSessionStatus };

export interface RealSessionSummary {
  id: number;
  startedAt: string;
  endedAt: string | null;
  status: RealSessionStatus;
  label: string | null;
  notes: string | null;
  baselineCapital: number;
  endingEquity: number | null;
  endingSessionPnl: number | null;
  snapshotCount: number;
  peakEquity: number | null;
  troughEquity: number | null;
  /** Live session PnL when active (endingSessionPnl when closed). */
  sessionPnl: number | null;
  durationMs: number | null;
  archiveSummary: RealArchiveSummary | null;
  /** Frozen config snapshot at session creation (or last meta re-stamp). */
  config: RealRiskConfigSnapshot | null;
}

export interface ListRealSessionsOptions {
  limit?: number;
  offset?: number;
  status?: RealSessionStatus;
  label?: string;
  from?: string;
  to?: string;
}

export interface UpdateRealSessionOptions {
  label?: string | null;
  notes?: string | null;
}
