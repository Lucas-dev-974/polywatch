import { Show } from 'solid-js';
import { formatShortDateTime } from '../lib/date';
import { formatPnlAmount, pnlClass } from '../lib/position';
import type {
  RealStateSnapshotSource,
  RealStateSnapshotSummary,
} from '../lib/real-snapshots';

const REAL_SNAPSHOT_SOURCE: Record<
  RealStateSnapshotSource,
  { badgeClass: string; badgeLabel: string }
> = {
  manual: { badgeClass: 'neutral', badgeLabel: 'Manuel' },
  auto: { badgeClass: 'real', badgeLabel: 'Auto' },
  rotate: { badgeClass: 'warn', badgeLabel: 'Clôture' },
};

interface Props {
  snapshot: RealStateSnapshotSummary;
  selected: boolean;
  onToggle: () => void;
  onDetail: () => void;
}

export function RealSnapshotCard(props: Props) {
  const source = () => REAL_SNAPSHOT_SOURCE[props.snapshot.source];

  return (
    <div class="sim-snapshot-card" classList={{ selected: props.selected }}>
      <label class="sim-snapshot-card-check">
        <input
          type="checkbox"
          checked={props.selected}
          onChange={() => props.onToggle()}
        />
      </label>
      <button
        type="button"
        class="sim-snapshot-card-body"
        onClick={() => props.onDetail()}
      >
        <div class="sim-snapshot-card-header">
          <span class={`badge ${source().badgeClass}`}>{source().badgeLabel}</span>
          <span class="sim-snapshot-card-date">
            {formatShortDateTime(props.snapshot.createdAt)}
          </span>
        </div>
        <div class="sim-snapshot-card-equity mono">
          {formatPnlAmount(props.snapshot.equity)}
          <span class="sim-snapshot-card-token">{props.snapshot.token}</span>
        </div>
        <div class={`sim-snapshot-card-pnl mono ${pnlClass(props.snapshot.sessionPnl)}`}>
          PnL {formatPnlAmount(props.snapshot.sessionPnl, true)}
        </div>
        <Show when={props.snapshot.label}>
          <div class="sim-snapshot-card-label">{props.snapshot.label}</div>
        </Show>
        <div class="sim-snapshot-card-meta">
          {props.snapshot.traderCount} traders · {props.snapshot.positionCount} positions
          {props.snapshot.sessionLabel
            ? ` · ${props.snapshot.sessionLabel}`
            : props.snapshot.sessionId != null
              ? ` · période #${props.snapshot.sessionId}`
              : ''}
        </div>
      </button>
    </div>
  );
}
