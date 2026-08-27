import type { MarketChartContext } from '../../lib/market-chart';
import { openMarketChart } from '../../stores/marketChartStore';
import { Icon } from '../Icon';

export interface AlgoMarketChartTriggerProps extends MarketChartContext {
  buttonClass: string;
  title?: string;
}

export function AlgoMarketChartTrigger(props: AlgoMarketChartTriggerProps) {
  function handleOpen() {
    openMarketChart({
      conditionId: props.conditionId,
      copiedPositionId: props.copiedPositionId,
      chartPositions: props.chartPositions,
      assetId: props.assetId,
      cryptoSymbol: props.cryptoSymbol,
      interval: props.interval,
      question: props.question,
      marketStartAt: props.marketStartAt,
      marketEndAt: props.marketEndAt,
      entryBidVwap: props.entryBidVwap,
      entryPrice: props.entryPrice,
      costPerShare: props.costPerShare,
      slPercent: props.slPercent,
      tpPercent: props.tpPercent,
      openedAt: props.openedAt,
      closedAt: props.closedAt,
      outcome: props.outcome,
      exitBidVwap: props.exitBidVwap,
      positionQuantity: props.positionQuantity,
    });
  }

  return (
    <button
      type="button"
      class={props.buttonClass}
      onClick={handleOpen}
      title={props.title ?? 'Cours marché'}
    >
      <Icon name="chart-line" size={14} />
    </button>
  );
}
