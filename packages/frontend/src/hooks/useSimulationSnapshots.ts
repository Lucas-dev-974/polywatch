import {
  deleteAllClosedSimulationSessions,
  deleteSimulationSession,
  fetchCurrentSimulationSession,
  fetchSimulationSessions,
  updateSimulationSession,
  type SimSessionSummary,
  type SimulationSessionListFilters,
} from '../lib/simulation-sessions';
import {
  deleteAllSimulationSnapshots,
  fetchSimulationSnapshotDetail,
  fetchSimulationSnapshots,
  type SimStateSnapshotDetail,
  type SimStateSnapshotSummary,
  type SimulationSnapshotListFilters,
} from '../lib/simulation-snapshots';
import { useSnapshots, type SnapshotPanelView, type UseSnapshotsApi } from './useSnapshots';
import type { SimAlgoKind } from '../lib/simulation';

export type { SnapshotPanelView };

export function useSimulationSnapshots(initialAlgoKind: SimAlgoKind = 'crypto') {
  const snap = useSnapshots(
    {
      configDiffMode: 'sim',
      refreshEvents: ['simulation_reset', 'simulation_snapshot_created'],
      labels: { session: 'session', sessions: 'sessions' },
      supportsAlgoKind: true,
      fetchSessions: (limit, offset, filters) =>
        fetchSimulationSessions(limit, offset, filters as SimulationSessionListFilters),
      fetchCurrentSession: (algoKind) =>
        fetchCurrentSimulationSession(algoKind ?? 'crypto'),
      updateSession: (id, patch) => updateSimulationSession(id, patch),
      deleteSession: (id, algoKind, deleteSnapshots) =>
        deleteSimulationSession(id, algoKind ?? 'crypto', deleteSnapshots),
      deleteAllClosedSessions: (algoKind) =>
        deleteAllClosedSimulationSessions(algoKind ?? 'crypto'),
      fetchSnapshots: (limit, offset, filters) =>
        fetchSimulationSnapshots(limit, offset, filters as SimulationSnapshotListFilters),
      fetchSnapshotDetail: (id) => fetchSimulationSnapshotDetail(id),
      deleteAllSnapshots: (algoKind) =>
        deleteAllSimulationSnapshots(algoKind ?? 'crypto'),
    },
    {
      initialAlgoKind,
      initialSnapshotFilters: { source: 'all' } as SimulationSnapshotListFilters,
      initialSessionFilters: { status: 'all', algoKind: initialAlgoKind } as SimulationSessionListFilters,
    },
  );

  // Les types Sim/Real des libs sont des supersets des shapes — le cast est
  // structurellement sûr (vérifié sur les champs consommés par les panels).
  return snap as unknown as UseSnapshotsApi<
    SimStateSnapshotSummary,
    SimSessionSummary,
    SimStateSnapshotDetail,
    SimulationSnapshotListFilters,
    SimulationSessionListFilters
  >;
}
