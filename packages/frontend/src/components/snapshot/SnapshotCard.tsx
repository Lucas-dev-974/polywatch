import { Show } from 'solid-js';
import { formatShortDateTime } from '../../lib/date';
import { formatPnlAmount, pnlClass } from '../../lib/position';

interface SourceBadge {
  badgeClass: string;
  badgeLabel: string;
}

interface Props {
  snapshot: {
    id: number;
    createdAt: string;
    label: string | null;
    source: string;
    sessionId?: number | null;
    sessionLabel?: string | null;
    equity: number;
    token: string;
    sessionPnl: number;
    traderCount: number;
    positionCount: number;
    executionCount?: number;
  };
  /** Badge pour la source (sim: reset, real: rotate). */
  sourceBadge: SourceBadge;
  /** Libellé de la session (sim: 'Session', real: 'période'). */
  sessionLabel: string;
  /** Le panel sim affiche un bouton "Voir le détail" + label "Comparer" ; real est cliquable sur le body. */
  variant: 'sim' | 'real';
  selected: boolean;
  onToggle: () => void;
  onDetail: () => void;
}

export function SnapshotCard(props: Props) {
  return (
    <div class="sim-snapshot-card" classList={{ selected: props.selected }}>
      <label class="sim-snapshot-card-check">
        <input type="checkbox" checked={props.selected} onChange={() => props.onToggle()} />
        {props.variant === 'sim' ? (
          <span class="sim-snapshot-card-check-label">Comparer</span>
        ) : null}
      </label>
      {props.variant === 'real' ? (
        <button type="button" class="sim-snapshot-card-body" onClick={() => props.onDetail()}>
          <CardBody {...props} />
        </button>
      ) : (
        <div>
          <CardBody {...props} />
          <button
            type="button"
            class="btn btn-ghost btn-sm sim-snapshot-card-detail"
            onClick={() => props.onDetail()}
          >
            Voir le détail
          </button>
        </div>
      )}
    </div>
  );
}

function CardBody(props: Props) {
  return (
    <>
      <div class="sim-snapshot-card-header">
        <span class={`badge ${props.sourceBadge.badgeClass}`}>
          {props.sourceBadge.badgeLabel}
        </span>
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
            ? ` · ${props.sessionLabel} #${props.snapshot.sessionId}`
            : ''}
      </div>
    </>
  );
}
