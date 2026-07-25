import { Show } from 'solid-js';

import {
  POSITION_TOOLTIPS,
  positionStatusTooltip,
  reinforcementsTooltip,
  traderTooltip,
} from '../../lib/position-tooltips';
import {
  liquidityStatusLabel,
  modeLabel,
  positionStatusBadgeClass,
  positionStatusLabel,
  type Position,
} from '../../lib/position';

type IdentityFields = Pick<
  Position,
  | 'traderName'
  | 'traderAddress'
  | 'outcome'
  | 'mode'
  | 'status'
  | 'liquidityStatus'
  | 'increaseCount'
>;

interface Props {
  pos: IdentityFields;
  bookHealthy?: boolean;
}

export function PositionRowIdentity(props: Props) {
  const pos = () => props.pos;
  const statusLabel = () => positionStatusLabel(pos().status);
  const liqLabel = () => liquidityStatusLabel(pos().liquidityStatus);

  return (
    <div class="position-row-identity">
      <span
        class="position-row-trader"
        title={traderTooltip(pos().traderAddress)}
      >
        {pos().traderName ?? '—'}
      </span>
      <span class="position-outcome" title={POSITION_TOOLTIPS.outcome}>
        {pos().outcome}
      </span>
      <span
        class={`badge badge-xs ${pos().mode}`}
        title={POSITION_TOOLTIPS.mode}
      >
        {modeLabel(pos().mode)}
      </span>
      <Show when={statusLabel()}>
        <span
          class={`badge badge-xs ${positionStatusBadgeClass(pos().status)}`}
          title={positionStatusTooltip(pos().status)}
        >
          {statusLabel()}
        </span>
      </Show>
      <Show when={liqLabel()}>
        <span
          class="badge badge-xs warn"
          title={POSITION_TOOLTIPS.liquidity}
        >
          {liqLabel()}
        </span>
      </Show>
      <Show when={props.bookHealthy === false}>
        <span class="badge badge-xs warn" title={POSITION_TOOLTIPS.bookDegraded}>
          Carnet
        </span>
      </Show>
      <Show when={(pos().increaseCount ?? 0) > 0}>
        <span
          class="position-row-reinforce"
          title={reinforcementsTooltip(pos().increaseCount!)}
        >
          +{pos().increaseCount}
        </span>
      </Show>
    </div>
  );
}
