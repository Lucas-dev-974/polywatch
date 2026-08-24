import { Show } from 'solid-js';

import { formatDurationBetween, formatShortDateTime } from '../../lib/date';
import { closeReasonTooltip, POSITION_TOOLTIPS } from '../../lib/position-tooltips';
import {
  closeReasonBadgeClass,
  closeReasonLabel,
  investedAmount,
  pnlPercent,
  type Position,
} from '../../lib/position';
import { PositionMarketLink } from './PositionMarketLink';
import { PositionRow, PositionRowMetaSep } from './PositionRow';
import { PositionRowIdentity } from './PositionRowIdentity';
import { PositionRowPnl } from './PositionRowPnl';
import { PositionRowSizing } from './PositionRowSizing';
import { PositionMarketChartTrigger } from '../PositionMarketChartTrigger';

interface Props {
  pos: Position;
  hideMarketLink?: boolean;
  hideMarketChartTrigger?: boolean;
}

export function ClosedPositionRow(props: Props) {
  const pos = () => props.pos;
  const invested = () => investedAmount(pos());
  const pnlPct = () => pnlPercent(pos().realizedPnl, invested());

  return (
    <PositionRow
      meta={
        <>
          {/* Ligne 1 : dates */}
          <div class="position-row-meta-line">
            <Show when={pos().openedAt}>
              <span class="text-mono" title={POSITION_TOOLTIPS.openedAt}>
                {formatShortDateTime(pos().openedAt)}
              </span>
            </Show>
            <Show when={pos().openedAt && pos().closedAt}>
              <PositionRowMetaSep char="→" />
            </Show>
            <Show when={pos().closedAt}>
              <span class="text-mono" title={POSITION_TOOLTIPS.closedAt}>
                {formatShortDateTime(pos().closedAt)}
              </span>
            </Show>
            <Show when={pos().openedAt}>
              <PositionRowMetaSep />
              <span title={POSITION_TOOLTIPS.duration}>
                {formatDurationBetween(pos().openedAt, pos().closedAt)}
              </span>
            </Show>
          </div>
          {/* Ligne 2 : prix */}
          <div class="position-row-meta-line">
            <PositionRowSizing pos={pos()} />
          </div>
        </>
      }
      footer={
        <Show when={!props.hideMarketChartTrigger || pos().closeReason}>
          <div class="position-row-footer">
            <Show when={!props.hideMarketChartTrigger}>
              <PositionMarketChartTrigger pos={pos()} />
            </Show>
            <Show when={pos().closeReason}>
              <span
                class={`badge badge-xs ${closeReasonBadgeClass(pos().closeReason)}`}
                title={closeReasonTooltip(pos().closeReason)}
              >
                {closeReasonLabel(pos().closeReason)}
              </span>
            </Show>
          </div>
        </Show>
      }
      aside={
        <PositionRowPnl
          amount={pos().realizedPnl}
          percent={pnlPct()}
          mode={pos().mode}
        />
      }
    >
      <PositionRowIdentity pos={pos()} />
      <Show when={!props.hideMarketLink}>
        <PositionMarketLink pos={pos()} compact />
      </Show>
    </PositionRow>
  );
}
