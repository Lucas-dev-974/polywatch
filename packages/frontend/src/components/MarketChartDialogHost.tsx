import { Show, onCleanup } from 'solid-js';
import {
  closeMarketChart,
  marketChartContext,
} from '../stores/marketChartStore';
import { MarketChartDialog } from './MarketChartDialog';

export function MarketChartDialogHost() {
  onCleanup(() => closeMarketChart());

  return (
    <Show when={marketChartContext()}>
      {(ctx) => (
        <MarketChartDialog
          onClose={closeMarketChart}
          conditionId={ctx().conditionId}
          copiedPositionId={ctx().copiedPositionId}
          chartPositions={ctx().chartPositions}
          assetId={ctx().assetId}
          cryptoSymbol={ctx().cryptoSymbol}
          interval={ctx().interval}
          question={ctx().question}
          marketStartAt={ctx().marketStartAt}
          marketEndAt={ctx().marketEndAt}
          entryBidVwap={ctx().entryBidVwap}
          entryPrice={ctx().entryPrice}
          slBidPoints={ctx().slBidPoints}
          tpBidPoints={ctx().tpBidPoints}
          openedAt={ctx().openedAt}
          closedAt={ctx().closedAt}
          outcome={ctx().outcome}
          exitBidVwap={ctx().exitBidVwap}
          positionQuantity={ctx().positionQuantity}
        />
      )}
    </Show>
  );
}
