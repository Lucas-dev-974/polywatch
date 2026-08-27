import { For, Show } from 'solid-js';
import { formatPnlAmount, pnlClass } from '../../lib/position';
import { marketDisplayLabel, type MarketAnalyticsRow } from '../../lib/market-analytics';
import type { TraderPnlSeriesPoint } from '../../lib/trader-analytics';
import { TraderPnlEvolutionChart } from '../charts/TraderPnlEvolutionChart';

interface Props {
  markets: MarketAnalyticsRow[];
  selectedConditionId: string | null;
  onSelectConditionId: (conditionId: string | null) => void;
  pnlSeries: TraderPnlSeriesPoint[];
  seriesLoading: boolean;
  seriesHint: string | null;
  currentTotalPnl: number;
  currentPnlScopeLabel: string;
}

export function SimMarketAnalyticsChartSection(props: Props) {
  return (
    <section class="sim-analytics-chart-section">
      <h3 class="sim-analytics-section-title">Courbe PnL par marché</h3>
      <div class="sim-analytics-chart-controls">
        <label class="sim-analytics-chart-field">
          <span class="sim-analytics-chart-field-label">Marché</span>
          <select
            class="input input-sm"
            value={props.selectedConditionId ?? ''}
            onChange={(e) => {
              const value = e.currentTarget.value;
              props.onSelectConditionId(value || null);
            }}
          >
            <option value="">Sélectionnez un marché</option>
            <For each={props.markets}>
              {(market) => (
                <option value={market.conditionId}>
                  {marketDisplayLabel(market)}
                </option>
              )}
            </For>
          </select>
        </label>
      </div>
      <TraderPnlEvolutionChart
        points={props.pnlSeries}
        loading={props.seriesLoading}
        hint={props.seriesHint}
      />
      <Show when={props.selectedConditionId != null}>
        <p class="sim-analytics-chart-meta">
          PnL actuel
          {props.currentPnlScopeLabel}
          {' : '}
          <span class={pnlClass(props.currentTotalPnl)}>
            {formatPnlAmount(props.currentTotalPnl, true)}
          </span>
        </p>
      </Show>
    </section>
  );
}
