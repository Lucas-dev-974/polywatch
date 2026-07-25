import { Show } from 'solid-js';
import { displayAlgoSymbol } from '../lib/algo-market-display';
import { formatMarketWindow, parseMarketWindowMs } from '../lib/market-chart';

export interface MarketChartMetaProps {
  question?: string | null;
  cryptoSymbol?: string | null;
  interval?: string | null;
  marketStartAt?: string | null;
  marketEndAt?: string | null;
}

export function MarketChartMeta(props: MarketChartMetaProps) {
  const marketStartMs = () => parseMarketWindowMs(props.marketStartAt);
  const marketEndMs = () => parseMarketWindowMs(props.marketEndAt);

  return (
    <>
      <Show when={props.question}>
        <p class="market-chart-question" title={props.question!}>
          {props.question}
        </p>
      </Show>

      <div class="market-chart-meta">
        <Show when={props.cryptoSymbol}>
          <span class="market-chart-badge market-chart-badge-symbol">
            {displayAlgoSymbol(props.cryptoSymbol!)}
          </span>
        </Show>
        <Show when={props.interval}>
          <span class="market-chart-badge market-chart-badge-interval">
            {props.interval}
          </span>
        </Show>
        <Show when={marketStartMs() != null && marketEndMs() != null}>
          <span class="market-chart-badge market-chart-badge-window">
            {formatMarketWindow(props.marketStartAt, props.marketEndAt)}
          </span>
        </Show>
      </div>
    </>
  );
}
