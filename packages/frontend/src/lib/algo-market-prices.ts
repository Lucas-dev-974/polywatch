import type { MarketPercentUpdate } from '@polywatch/core/market-list';
import type { AlgoMarketPrice, AlgoMarketsPricesResponse } from '../components/algo/AlgoMarketCard';

function applyOutcomePrices(
  market: AlgoMarketPrice,
  outcomePrices: { outcome: string; price: number }[],
): AlgoMarketPrice {
  const up = outcomePrices.find(
    (p) => p.outcome.toLowerCase() === 'up' || p.outcome.toLowerCase() === 'yes',
  );
  const down = outcomePrices.find(
    (p) => p.outcome.toLowerCase() === 'down' || p.outcome.toLowerCase() === 'no',
  );

  return {
    ...market,
    upPrice: up?.price ?? market.upPrice,
    downPrice: down?.price ?? market.downPrice,
  };
}

/** Merge WebSocket percent updates into the live slice of an algo markets-prices payload. */
export function mergeMarketPercentUpdates(
  current: AlgoMarketsPricesResponse | undefined,
  updates: MarketPercentUpdate[],
): AlgoMarketsPricesResponse | undefined {
  if (!current?.live?.length) return current;

  const byConditionId = new Map(updates.map((u) => [u.conditionId, u.outcomePrices]));
  const live = current.live.map((market) => {
    const outcomePrices = byConditionId.get(market.conditionId);
    if (!outcomePrices?.length) return market;
    return applyOutcomePrices(market, outcomePrices);
  });

  return { ...current, live };
}
