import { SnapshotsPanel } from './SnapshotsPanel';
import { useRealSnapshots } from '../hooks/useRealSnapshots';
import { RealSnapshotDialog } from './dialogs/RealSnapshotDialog';
import { RealSnapshotSettingsDialog } from './dialogs/RealSnapshotSettingsDialog';
import { RealSessionArchiveDialog } from './dialogs/RealSessionArchiveDialog';
import type { UseSnapshotsApi } from '../hooks/useSnapshots';
import type { RealSessionSummary } from '../lib/real-sessions';
import type { SimSessionSummary } from '../lib/simulation-sessions';
import type { SimStateSnapshotDetail, SimStateSnapshotSummary } from '../lib/simulation-snapshots';

export function RealSnapshotsPanel() {
  const snap = useRealSnapshots();
  // Les types Real sont des supersets des types Sim sur les champs consommés —
  // cast structurel (pattern historique asSim*). Le panneau partagé travaille
  // sur les types Sim.
  const simSnap = snap as unknown as UseSnapshotsApi<
    SimStateSnapshotSummary,
    SimSessionSummary,
    SimStateSnapshotDetail
  >;
  return (
    <SnapshotsPanel
      snap={simSnap}
      title="Snapshots réel"
      noun="période"
      nouns="périodes"
      sessionsEmptyHint="Une période démarre au premier snapshot ou au seed, et se clôture via « Clôturer la période »."
      compareConfigMode="real"
      renderCreateDialog={({ open, onClose, onCreated }) => (
        <RealSnapshotDialog open={open} onClose={onClose} onCreated={onCreated} />
      )}
      renderSettingsDialog={({ open, onClose }) => (
        <RealSnapshotSettingsDialog open={open} onClose={onClose} />
      )}
      renderArchiveDialog={({ open, session, onClose }) => (
        <RealSessionArchiveDialog
          open={open}
          session={session as unknown as RealSessionSummary | null}
          onClose={onClose}
        />
      )}
    />
  );
}
