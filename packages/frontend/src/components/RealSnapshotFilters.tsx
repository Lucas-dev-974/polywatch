import { SnapshotFilters } from './SnapshotFilters';
import type { RealSnapshotListFilters } from '../lib/real-snapshots';

interface Props {
  filters: RealSnapshotListFilters;
  onSourceChange: (source: RealSnapshotListFilters['source']) => void;
  onLabelChange: (label: string) => void;
  onFromChange: (from: string) => void;
  onToChange: (to: string) => void;
  onClear: () => void;
}

export function RealSnapshotFilters(props: Props) {
  return (
    <SnapshotFilters
      filters={props.filters}
      sourceOptions={[
        { value: 'manual', label: 'Manuel' },
        { value: 'auto', label: 'Automatique' },
        { value: 'rotate', label: 'Clôture période' },
      ]}
      onSourceChange={(source) => props.onSourceChange(source as RealSnapshotListFilters['source'])}
      onLabelChange={props.onLabelChange}
      onFromChange={props.onFromChange}
      onToChange={props.onToChange}
      onClear={props.onClear}
    />
  );
}
