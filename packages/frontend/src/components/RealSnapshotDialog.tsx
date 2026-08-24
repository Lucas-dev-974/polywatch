import { SnapshotDialog } from './SnapshotDialog';
import { createRealSnapshot } from '../lib/real-snapshots';

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

export function RealSnapshotDialog(props: Props) {
  return (
    <SnapshotDialog
      open={props.open}
      onClose={props.onClose}
      onCreated={props.onCreated}
      title="Enregistrer un snapshot réel"
      hint="Capture l’état observationnel du portefeuille (cash wallet + positions) sans modifier le capital on-chain."
      onCreate={(label) => createRealSnapshot(label)}
    />
  );
}
