import { SnapshotCard } from './SnapshotCard';
import type { RealStateSnapshotSummary } from '../lib/real-snapshots';

const REAL_SNAPSHOT_SOURCE: Record<string, { badgeClass: string; badgeLabel: string }> = {
  manual: { badgeClass: 'neutral', badgeLabel: 'Manuel' },
  auto: { badgeClass: 'real', badgeLabel: 'Auto' },
  rotate: { badgeClass: 'warn', badgeLabel: 'Clôture' },
  config_change: { badgeClass: 'warn', badgeLabel: 'Config' },
};

interface Props {
  snapshot: RealStateSnapshotSummary;
  selected: boolean;
  onToggle: () => void;
  onDetail: () => void;
}

export function RealSnapshotCard(props: Props) {
  return (
    <SnapshotCard
      snapshot={props.snapshot}
      sourceBadge={REAL_SNAPSHOT_SOURCE[props.snapshot.source] ?? { badgeClass: 'neutral', badgeLabel: props.snapshot.source }}
      sessionLabel="période"
      variant="real"
      selected={props.selected}
      onToggle={props.onToggle}
      onDetail={props.onDetail}
    />
  );
}
