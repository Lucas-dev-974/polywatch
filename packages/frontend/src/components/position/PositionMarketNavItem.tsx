import { Show } from 'solid-js';

import {
  formatPnlAmount,
  pnlClass,
  type MarketGroup,
} from '../../lib/position';
import { MarketIcon } from './MarketIcon';

interface Props {
  group: MarketGroup;
  net: () => number;
  isActive: () => boolean;
  showPnl: boolean;
  onSelect: () => void;
}

export function PositionMarketNavItem(props: Props) {
  return (
    <button
      type="button"
      class={`position-market-nav-item${props.isActive() ? ' is-active' : ''}`}
      aria-current={props.isActive() ? 'true' : undefined}
      onClick={props.onSelect}
    >
      <MarketIcon conditionId={props.group.conditionId} label={props.group.label} />
      <span class="position-market-nav-body">
        <span class="position-market-nav-label">{props.group.label}</span>
        <span class="position-market-nav-meta">
          <span class="badge badge-xs neutral">{props.group.positions.length}</span>
          <Show when={props.showPnl}>
            <span class={`position-market-nav-pnl ${pnlClass(props.net())}`}>
              {formatPnlAmount(props.net(), true)}
            </span>
          </Show>
        </span>
      </span>
    </button>
  );
}
