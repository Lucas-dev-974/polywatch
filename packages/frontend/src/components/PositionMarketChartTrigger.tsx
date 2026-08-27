import { createMemo, Show } from 'solid-js';

import { positionToMarketChartContext } from '../lib/position-market-chart';
import { POSITION_TOOLTIPS } from '../lib/position-tooltips';
import type { Position } from '../lib/position';
import { AlgoMarketChartTrigger } from './algo/AlgoMarketChartTrigger';

interface Props {
  pos: Position;
  buttonClass?: string;
}

const DEFAULT_BUTTON_CLASS = 'btn btn-secondary btn-sm';

export function PositionMarketChartTrigger(props: Props) {
  const ctx = createMemo(() => positionToMarketChartContext(props.pos));

  return (
    <Show when={ctx()}>
      {(chartCtx) => (
        <AlgoMarketChartTrigger
          buttonClass={props.buttonClass ?? DEFAULT_BUTTON_CLASS}
          title={POSITION_TOOLTIPS.marketChart}
          conditionId={chartCtx().conditionId}
          copiedPositionId={chartCtx().copiedPositionId}
          chartPositions={chartCtx().chartPositions}
          assetId={chartCtx().assetId}
          cryptoSymbol={chartCtx().cryptoSymbol}
          interval={chartCtx().interval}
          question={chartCtx().question}
          marketStartAt={chartCtx().marketStartAt}
          marketEndAt={chartCtx().marketEndAt}
          entryBidVwap={chartCtx().entryBidVwap}
          entryPrice={chartCtx().entryPrice}
          costPerShare={chartCtx().costPerShare}
          slPercent={chartCtx().slPercent}
          tpPercent={chartCtx().tpPercent}
          openedAt={chartCtx().openedAt}
          closedAt={chartCtx().closedAt}
          outcome={chartCtx().outcome}
          exitBidVwap={chartCtx().exitBidVwap}
          positionQuantity={chartCtx().positionQuantity}
        />
      )}
    </Show>
  );
}
