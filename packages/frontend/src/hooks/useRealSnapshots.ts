import {
  deleteAllClosedRealSessions,
  deleteRealSession,
  fetchCurrentRealSession,
  fetchRealSessions,
  updateRealSession,
  type RealSessionSummary,
  type RealSessionListFilters,
} from '../lib/real-sessions';
import {
  deleteAllRealSnapshots,
  fetchRealSnapshotDetail,
  fetchRealSnapshots,
  type RealStateSnapshotDetail,
  type RealStateSnapshotSummary,
  type RealSnapshotListFilters,
} from '../lib/real-snapshots';
import { useSnapshots, type SnapshotPanelView, type UseSnapshotsApi } from './useSnapshots';

export const SNAPSHOT_PAGE_SIZE = 12;
export const SNAPSHOT_CHART_LIMIT = 200;
export const SESSION_PAGE_SIZE = 12;

export type { SnapshotPanelView };

export function useRealSnapshots() {
  const snap = useSnapshots(
    {
      configDiffMode: 'real',
      refreshEvents: ['real_period_rotated', 'real_snapshot_created'],
      labels: { session: 'période', sessions: 'périodes' },
      supportsAlgoKind: false,
      fetchSessions: (limit, offset, filters) =>
        fetchRealSessions(limit, offset, filters as RealSessionListFilters),
      fetchCurrentSession: () => fetchCurrentRealSession(),
      updateSession: (id, patch) => updateRealSession(id, patch),
      deleteSession: (id, _algoKind, deleteSnapshots) => deleteRealSession(id, deleteSnapshots),
      deleteAllClosedSessions: () => deleteAllClosedRealSessions(),
      fetchSnapshots: (limit, offset, filters) =>
        fetchRealSnapshots(limit, offset, filters as RealSnapshotListFilters),
      fetchSnapshotDetail: (id) => fetchRealSnapshotDetail(id),
      deleteAllSnapshots: () => deleteAllRealSnapshots(),
    },
    {
      initialSnapshotFilters: { source: 'all' } as RealSnapshotListFilters,
      initialSessionFilters: { status: 'all' } as RealSessionListFilters,
    },
  );

  // Les types Sim/Real des libs sont des supersets des shapes — le cast est
  // structurellement sûr (vérifié sur les champs consommés par les panels).
  return snap as unknown as UseSnapshotsApi<
    RealStateSnapshotSummary,
    RealSessionSummary,
    RealStateSnapshotDetail,
    RealSnapshotListFilters,
    RealSessionListFilters
  >;
}
