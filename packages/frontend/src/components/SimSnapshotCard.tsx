import { Show } from 'solid-js';
import { formatShortDateTime } from '../lib/date';
import { formatPnlAmount, pnlClass } from '../lib/position';
import { SNAPSHOT_SOURCE } from '../lib/sim-snapshot-compare';
import type { SimStateSnapshotSummary } from '../lib/simulation-snapshots';

interface Props {
  snapshot: SimStateSnapshotSummary;
  selected: boolean;
  onToggle: () => void;
  onDetail: () => void;
}

export function SimSnapshotCard(props: Props) {
  const source = () => SNAPSHOT_SOURCE[props.snapshot.source];

  return (
    <div class="sim-snapshot-card" classList={{ selected: props.selected }}>
      <label class="sim-snapshot-card-check">
        <input
          type="checkbox"
          checked={props.selected}
          onChange={() => props.onToggle()}
        />
        <span class="sim-snapshot-card-check-label">Comparer</span>
      </label>
      <div class="sim-snapshot-card-header">
        <span class={`badge badge-xs ${source().badgeClass}`}>
          {source().badgeLabel}
        </span>
        <time class="sim-snapshot-card-date">
          {formatShortDateTime(props.snapshot.createdAt)}
        </time>
      </div>
      <Show when={props.snapshot.label}>
        <div class="sim-snapshot-card-label">{props.snapshot.label}</div>
      </Show>
      <Show when={props.snapshot.sessionId != null}>
        <div class="sim-snapshot-card-session">
          {props.snapshot.sessionLabel?.trim() ||
            `Session #${props.snapshot.sessionId}`}
        </div>
      </Show>
      <div class="sim-snapshot-card-equity stat-value mono">
        {formatPnlAmount(props.snapshot.equity)}
        <span class="mode-hero-token">{props.snapshot.token}</span>
      </div>
      <div
        class={`sim-snapshot-card-pnl mono ${pnlClass(props.snapshot.sessionPnl)}`}
      >
        PnL session {formatPnlAmount(props.snapshot.sessionPnl, true)}
      </div>
      <div class="sim-snapshot-card-meta">
        {props.snapshot.traderCount} traders · {props.snapshot.positionCount} pos. ·{' '}
        {props.snapshot.executionCount} exéc.
      </div>
      <button
        type="button"
        class="btn btn-ghost btn-sm sim-snapshot-card-detail"
        onClick={() => props.onDetail()}
      >
        Voir le détail
      </button>
    </div>
  );
}
