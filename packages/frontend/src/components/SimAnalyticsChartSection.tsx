import { For, Show } from 'solid-js';
import { formatPnlAmount, pnlClass } from '../lib/position';
import { traderDisplayName, type TraderAnalyticsRow, type TraderMarketOption } from '../lib/trader-analytics';
import type { TraderPnlSeriesPoint } from '../lib/trader-analytics';
import { TraderPnlEvolutionChart } from './charts/TraderPnlEvolutionChart';

interface Props {
  selectableTraders: TraderAnalyticsRow[];
  marketOptions: TraderMarketOption[];
  selectedWatchlistId: number | null;
  selectedConditionId: string | null;
  onSelectTrader: (watchlistId: number | null) => void;
  onSelectConditionId: (conditionId: string | null) => void;
  pnlSeries: TraderPnlSeriesPoint[];
  seriesLoading: boolean;
  seriesHint: string | null;
  currentTotalPnl: number;
  currentPnlScopeLabel: string;
}

export function SimAnalyticsChartSection(props: Props) {
  return (
    <section class="sim-analytics-chart-section">
      <h3 class="sim-analytics-section-title">Courbe PnL</h3>
      <div class="sim-analytics-chart-controls">
        <label class="sim-analytics-chart-field">
          <span class="sim-analytics-chart-field-label">Trader</span>
          <select
            class="input input-sm"
            value={props.selectedWatchlistId ?? ''}
            onChange={(e) => {
              const id = Number(e.currentTarget.value);
              if (Number.isFinite(id)) props.onSelectTrader(id);
            }}
          >
            <For each={props.selectableTraders}>
              {(trader) => (
                <option value={trader.watchlistId ?? ''}>
                  {traderDisplayName(trader)}
                </option>
              )}
            </For>
          </select>
        </label>
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
            <option value="">Tous les marchés</option>
            <For each={props.marketOptions}>
              {(market) => (
                <option value={market.conditionId}>{market.label}</option>
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
      <Show when={props.selectedWatchlistId != null}>
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
