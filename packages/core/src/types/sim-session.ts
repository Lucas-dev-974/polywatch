import type { SimulationSessionStatus } from '../entities/SimulationSession.js';
import type { SimArchiveSummary } from './sim-session-archive.js';
import type { SimRiskConfigSnapshot } from '../risk/sim-mode-fields.js';
import type { SimAlgoKind } from '../simulation/algo-kind.js';

export type { SimulationSessionStatus };

export interface SimSessionSummary {
  id: number;
  algoKind: SimAlgoKind;
  startedAt: string;
  endedAt: string | null;
  status: SimulationSessionStatus;
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
  archiveSummary: SimArchiveSummary | null;
  /** Frozen config snapshot at session creation (or last meta re-stamp). */
  config: SimRiskConfigSnapshot | null;
}

export interface ListSimSessionsOptions {
  algoKind: SimAlgoKind;
  limit?: number;
  offset?: number;
  status?: SimulationSessionStatus;
  label?: string;
  from?: string;
  to?: string;
}

export interface UpdateSimSessionOptions {
  label?: string | null;
  notes?: string | null;
}
