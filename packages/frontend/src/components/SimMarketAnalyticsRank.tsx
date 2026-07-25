import { For } from 'solid-js';
import { formatPnlAmount, pnlClass } from '../lib/position';
import { marketDisplayLabel, type MarketAnalyticsRow } from '../lib/market-analytics';

interface Props {
  markets: MarketAnalyticsRow[];
}

export function SimMarketAnalyticsRank(props: Props) {
  const rankScale = () => {
    const values = props.markets.map((m) => Math.abs(m.totalPnl));
    return Math.max(...values, 1);
  };

  return (
    <section class="sim-analytics-rank">
      <h3 class="sim-analytics-section-title">Classement PnL par marché</h3>
      <For each={props.markets.filter((m) => m.totalPnl !== 0 || m.positionCount > 0)}>
        {(market) => {
          const width = () =>
            `${(Math.abs(market.totalPnl) / rankScale()) * 100}%`;
          return (
            <div class="sim-analytics-rank-row">
              <span class="sim-analytics-rank-label">
                {marketDisplayLabel(market)}
              </span>
              <div class="sim-analytics-rank-bar-wrap">
                <div
                  class="sim-analytics-rank-bar"
                  classList={{
                    'is-positive': market.totalPnl > 0,
                    'is-negative': market.totalPnl < 0,
                  }}
                  style={{ width: width() }}
                />
              </div>
              <span class={`sim-analytics-rank-value ${pnlClass(market.totalPnl)}`}>
                {formatPnlAmount(market.totalPnl, true)}
              </span>
            </div>
          );
        }}
      </For>
    </section>
  );
}
