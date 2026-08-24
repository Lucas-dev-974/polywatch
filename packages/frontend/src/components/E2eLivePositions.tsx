import { For, Show } from 'solid-js';
import {
  type E2ePositionDto,
  formatPrice,
  formatPnlPercent,
} from '../lib/e2e-runs';

export interface E2eLivePositionsProps {
  positions: E2ePositionDto[];
  waiting: boolean;
}

export function E2eLivePositions(props: E2eLivePositionsProps) {
  return (
    <div class="e2e-live-positions">
      <h4 class="subsection-title">Positions détectées</h4>
      <Show
        when={props.positions.length > 0}
        fallback={
          <p class="text-muted e2e-live-positions-empty">
            {props.waiting
              ? 'En attente de détection de position…'
              : 'Aucune position détectée.'}
          </p>
        }
      >
        <div class="e2e-positions-grid">
          <For each={props.positions}>
            {(pos) => <E2ePositionCard position={pos} />}
          </For>
        </div>
      </Show>
    </div>
  );
}

function E2ePositionCard(props: { position: E2ePositionDto }) {
  const isOpen = () => props.position.status === 'open';
  const pnlClass = () => {
    const pnl = props.position.pnlPercent;
    if (pnl == null) return '';
    return pnl >= 0 ? 'e2e-position-pnl-positive' : 'e2e-position-pnl-negative';
  };

  return (
    <div class={`e2e-position-card e2e-position-${props.position.status}`}>
      <div class="e2e-position-card-header">
        <span class={`badge e2e-position-status-badge e2e-position-status-${props.position.status}`}>
          {isOpen() ? 'Ouverte' : 'Fermée'}
        </span>
        <Show when={props.position.closeReason}>
          <span class="text-muted e2e-position-close-reason">{props.position.closeReason}</span>
        </Show>
      </div>

      <div class="e2e-position-card-market">
        <span class="e2e-position-question">{props.position.marketQuestion ?? props.position.conditionId.slice(0, 12)}</span>
        <Show when={props.position.cryptoSymbol || props.position.interval}>
          <span class="text-muted">
            {props.position.cryptoSymbol ?? ''}
            {props.position.cryptoSymbol && props.position.interval ? ' · ' : ''}
            {props.position.interval ?? ''}
          </span>
        </Show>
      </div>

      <div class="e2e-position-card-details">
        <div class="e2e-position-detail">
          <span class="text-muted">Sens</span>
          <span>{props.position.side} {props.position.outcome}</span>
        </div>
        <div class="e2e-position-detail">
          <span class="text-muted">Qté</span>
          <span>{props.position.quantity.toFixed(2)}</span>
        </div>
        <div class="e2e-position-detail">
          <span class="text-muted">Entrée</span>
          <span class="e2e-position-price">{formatPrice(props.position.entryPrice)}</span>
        </div>
        <div class="e2e-position-detail">
          <span class="text-muted">Marché</span>
          <span class="e2e-position-price">
            {props.position.currentPrice != null ? formatPrice(props.position.currentPrice) : '—'}
          </span>
        </div>
      </div>

      <div class={`e2e-position-pnl ${pnlClass()}`}>
        <Show
          when={isOpen() && props.position.pnlPercent != null}
          fallback={
            <Show when={props.position.realizedPnl != null}>
              <span class="e2e-position-realized">
                PnL réalisé : {props.position.realizedPnl!.toFixed(4)}
              </span>
            </Show>
          }
        >
          <span class="e2e-position-pnl-value">{formatPnlPercent(props.position.pnlPercent)}</span>
          <span class="e2e-position-pnl-label">PnL live</span>
        </Show>
      </div>
    </div>
  );
}