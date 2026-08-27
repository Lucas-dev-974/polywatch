import { SnapshotCard } from '../snapshot/SnapshotCard';
import type { SimStateSnapshotSummary } from '../../lib/simulation-snapshots';

const SIM_SNAPSHOT_SOURCE: Record<string, { badgeClass: string; badgeLabel: string }> = {
  manual: { badgeClass: 'neutral', badgeLabel: 'Manuel' },
  auto: { badgeClass: 'sim', badgeLabel: 'Auto' },
  reset: { badgeClass: 'warn', badgeLabel: 'Reset' },
  config_change: { badgeClass: 'warn', badgeLabel: 'Config' },
};

interface Props {
  snapshot: SimStateSnapshotSummary;
  selected: boolean;
  onToggle: () => void;
  onDetail: () => void;
}

export function SimSnapshotCard(props: Props) {
  return (
    <SnapshotCard
      snapshot={props.snapshot}
      sourceBadge={SIM_SNAPSHOT_SOURCE[props.snapshot.source] ?? { badgeClass: 'neutral', badgeLabel: props.snapshot.source }}
      sessionLabel="Session"
      variant="sim"
      selected={props.selected}
      onToggle={props.onToggle}
      onDetail={props.onDetail}
    />
  );
}
