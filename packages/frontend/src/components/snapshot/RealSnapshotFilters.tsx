import { SnapshotFilters } from './SnapshotFilters';
import type { SnapshotFiltersShape } from '../../hooks/useSnapshots';

interface Props {
  filters: SnapshotFiltersShape;
  onSourceChange: (source: string | undefined) => void;
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
      onSourceChange={props.onSourceChange}
      onLabelChange={props.onLabelChange}
      onFromChange={props.onFromChange}
      onToChange={props.onToChange}
      onClear={props.onClear}
    />
  );
}
