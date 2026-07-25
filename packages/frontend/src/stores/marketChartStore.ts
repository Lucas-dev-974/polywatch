import { createSignal } from 'solid-js';
import type { MarketChartContext } from '../lib/market-chart';

const [marketChartContext, setMarketChartContext] =
  createSignal<MarketChartContext | null>(null);

export function openMarketChart(ctx: MarketChartContext) {
  setMarketChartContext(ctx);
}

export function closeMarketChart() {
  setMarketChartContext(null);
}

export { marketChartContext };
