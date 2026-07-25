import { Show } from 'solid-js';

import { openPnlMetrics, redemptionWaitHint, type PnlTick, type Position } from '../../lib/position';
import { PositionMarketLink } from './PositionMarketLink';
import { PositionOpenRowMeta } from './PositionOpenRowMeta';
import { PositionRow } from './PositionRow';
import { PositionRowIdentity } from './PositionRowIdentity';
import { OpenPositionRowPnl } from './OpenPositionRowPnl';
import { RedemptionWaitHint } from './RedemptionWaitHint';
import { PositionMarketChartTrigger } from '../PositionMarketChartTrigger';

interface Props {
  pos: Position;
  tick: () => PnlTick | undefined;
  now: () => number;
  hideMarketLink?: boolean;
  hideMarketChartTrigger?: boolean;
}

export function AwaitingRedemptionPositionRow(props: Props) {
  const pos = () => props.pos;
  const pnl = () => openPnlMetrics(pos(), props.tick());

  return (
    <PositionRow
      meta={<PositionOpenRowMeta pos={pos()} now={props.now} />}
      footer={
        <Show when={!props.hideMarketChartTrigger}>
          <div class="position-row-footer">
            <PositionMarketChartTrigger pos={pos()} />
          </div>
        </Show>
      }
      aside={
        <OpenPositionRowPnl
          amount={pnl().amount}
          closurePercent={pnl().closurePercent}
          triggerPercent={pnl().triggerPercent}
          mode={pos().mode}
        />
      }
    >
      <PositionRowIdentity
        pos={pos()}
        bookHealthy={props.tick()?.bookConnectionHealthy ?? true}
      />
      <RedemptionWaitHint hint={redemptionWaitHint(pos(), props.now())} />
      <Show when={!props.hideMarketLink}>
        <PositionMarketLink pos={pos()} compact />
      </Show>
    </PositionRow>
  );
}
