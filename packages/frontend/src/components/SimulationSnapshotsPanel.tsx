import { SnapshotsPanel } from './snapshot/SnapshotsPanel';
import { useSimulationSnapshots } from '../hooks/useSimulationSnapshots';
import { SimSnapshotDialog } from './dialogs/SimSnapshotDialog';
import { SimSnapshotSettingsDialog } from './dialogs/SimSnapshotSettingsDialog';
import { SimSessionArchiveDialog } from './dialogs/SimSessionArchiveDialog';
import type { SimAlgoKind } from '../lib/simulation';

const ALGO_TABS: { id: SimAlgoKind; label: string }[] = [
  { id: 'crypto', label: 'Crypto' },
  { id: 'weather', label: 'Weather' },
  { id: 'copy', label: 'Copy' },
];

export function SimulationSnapshotsPanel() {
  const snap = useSimulationSnapshots('crypto');
  return (
    <SnapshotsPanel
      snap={snap}
      title="Snapshots simulation"
      noun="session"
      nouns="sessions"
      algoTabs={ALGO_TABS}
      sessionsEmptyHint="Une session démarre au premier snapshot ou au seed, et se clôture à chaque réinitialisation."
      compareConfigMode="sim"
      renderCreateDialog={({ open, onClose, onCreated, algoKind }) => (
        <SimSnapshotDialog
          open={open}
          onClose={onClose}
          onCreated={onCreated}
          algoKind={algoKind}
        />
      )}
      renderSettingsDialog={({ open, onClose }) => (
        <SimSnapshotSettingsDialog open={open} onClose={onClose} />
      )}
      renderArchiveDialog={({ open, session, onClose }) => (
        <SimSessionArchiveDialog open={open} session={session} onClose={onClose} />
      )}
    />
  );
}
