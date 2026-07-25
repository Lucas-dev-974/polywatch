import { Show } from 'solid-js';

import { openPnlMetrics, type PnlTick, type Position } from '../../lib/position';
import { POSITION_TOOLTIPS } from '../../lib/position-tooltips';
import type { MarketTick } from '../../lib/market';
import { PositionCloseButton } from './PositionCloseButton';
import { PositionCloseErrorHint } from './PositionCloseErrorHint';
import { PositionMarketLink } from './PositionMarketLink';
import { PositionOpenRowMeta } from './PositionOpenRowMeta';
import { PositionRow } from './PositionRow';
import { PositionRowIdentity } from './PositionRowIdentity';
import { OpenPositionRowPnl } from './OpenPositionRowPnl';
import { PositionMarketChartTrigger } from '../PositionMarketChartTrigger';

interface Props {
  pos: Position;
  tick: () => PnlTick | undefined;
  marketTick: () => MarketTick | undefined;
  now: () => number;
  onClose: (id: number) => void;
  onOpenMarketMetrics: (pos: Position) => void;
  hideMarketLink?: boolean;
  hideMarketChartTrigger?: boolean;
}

export function OpenPositionRow(props: Props) {
  const pos = () => props.pos;
  const pnl = () => openPnlMetrics(pos(), props.tick());

  return (
    <PositionRow
        meta={<PositionOpenRowMeta pos={pos()} now={props.now} />}
        footer={
          <div class="position-row-footer">
            <button
              type="button"
              class="btn btn-secondary btn-sm"
              title={POSITION_TOOLTIPS.marketMetrics}
              onClick={() => props.onOpenMarketMetrics(pos())}
            >
              Marché
            </button>
            <Show when={!props.hideMarketChartTrigger}>
              <PositionMarketChartTrigger pos={pos()} />
            </Show>
          </div>
        }
        aside={
          <>
            <OpenPositionRowPnl
              amount={pnl().amount}
              closurePercent={pnl().closurePercent}
              triggerPercent={pnl().triggerPercent}
              mode={pos().mode}
              marketTick={props.marketTick()}
              slBidPoints={pos().slBidPoints}
              entryBidVwap={pos().entryBidVwap}
            />
            <PositionCloseButton
              pos={pos()}
              now={props.now}
              onClose={props.onClose}
            />
          </>
        }
      >
        <PositionRowIdentity
          pos={pos()}
          bookHealthy={props.tick()?.bookConnectionHealthy ?? true}
        />
        <PositionCloseErrorHint error={pos().lastCloseError} />
        <Show when={!props.hideMarketLink}>
          <PositionMarketLink pos={pos()} compact />
        </Show>
      </PositionRow>
  );
}
