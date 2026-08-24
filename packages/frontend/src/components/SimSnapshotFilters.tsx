import { SnapshotFilters } from './SnapshotFilters';
import type { SimulationSnapshotListFilters } from '../lib/simulation-snapshots';

interface Props {
  filters: SimulationSnapshotListFilters;
  onSourceChange: (source: SimulationSnapshotListFilters['source']) => void;
  onLabelChange: (label: string) => void;
  onFromChange: (from: string) => void;
  onToChange: (to: string) => void;
  onClear: () => void;
}

export function SimSnapshotFilters(props: Props) {
  return (
    <SnapshotFilters
      filters={props.filters}
      sourceOptions={[
        { value: 'manual', label: 'Manuel' },
        { value: 'auto', label: 'Automatique' },
        { value: 'reset', label: 'Reset' },
      ]}
      onSourceChange={(source) => props.onSourceChange(source as SimulationSnapshotListFilters['source'])}
      onLabelChange={props.onLabelChange}
      onFromChange={props.onFromChange}
      onToChange={props.onToChange}
      onClear={props.onClear}
    />
  );
}
