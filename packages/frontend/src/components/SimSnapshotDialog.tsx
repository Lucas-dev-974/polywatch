import { SnapshotDialog } from './SnapshotDialog';
import { createSimulationSnapshot } from '../lib/simulation-snapshots';
import type { SimAlgoKind } from '../lib/simulation';

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  algoKind: SimAlgoKind;
}

export function SimSnapshotDialog(props: Props) {
  return (
    <SnapshotDialog
      open={props.open}
      onClose={props.onClose}
      onCreated={props.onCreated}
      title="Enregistrer un snapshot"
      onCreate={(label) => createSimulationSnapshot(props.algoKind, label)}
    />
  );
}
