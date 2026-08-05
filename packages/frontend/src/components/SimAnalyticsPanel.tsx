import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { debounceFn } from '../lib/debounce';
import { formatPnlAmount, pnlClass } from '../lib/position';
import { compareTraders, defaultSortDirForKey, type SortDir, type SortKey } from '../lib/sim-analytics-sort';
import {
  aggregateTraderAnalyticsTotals,
  fetchTraderAnalytics,
  traderDisplayName,
  type MarketCategoryPnlRow,
} from '../lib/trader-analytics';
import { connectSocket } from '../socket';
import { useTraderPnlSeries } from '../hooks/useTraderPnlSeries';
import { CollapsiblePanel, useCollapse } from './CollapsiblePanel';
import { Icon } from './Icon';
import { SimAnalyticsCategoryChart } from './SimAnalyticsCategoryChart';
import { SimAnalyticsChartSection } from './SimAnalyticsChartSection';
import { SimAnalyticsTable } from './SimAnalyticsTable';
import { SimMarketAnalyticsPanel } from './SimMarketAnalyticsPanel';
import type { SimAlgoKind } from '../lib/simulation';

const REFRESH_DEBOUNCE_MS = 500;

const ALGO_LABEL: Record<SimAlgoKind, string> = {
  crypto: 'Crypto',
  weather: 'Weather',
  copy: 'Copy',
};

export interface SimAnalyticsPanelProps {
  algoKind?: SimAlgoKind;
}

export function SimAnalyticsPanel(props: SimAnalyticsPanelProps) {
  const [collapsed, setCollapsed] = useCollapse();
  const [traders, setTraders] = createSignal<Awaited<ReturnType<typeof fetchTraderAnalytics>>['traders']>([]);
  const [pnlByCategory, setPnlByCategory] = createSignal<MarketCategoryPnlRow[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [watchlistOnly, setWatchlistOnly] = createSignal(true);
  const [sortKey, setSortKey] = createSignal<SortKey>('totalPnl');
  const [sortDir, setSortDir] = createSignal<SortDir>('desc');

  const reloadAnalyticsRef: { current: () => Promise<void> } = {
    current: async () => {},
  };

  const filteredTraders = createMemo(() =>
    traders().filter((t) => (watchlistOnly() ? t.inWatchlistSim : true)),
  );

  const selectableTraders = createMemo(() =>
    filteredTraders().filter((t) => t.watchlistId != null && t.positionCount > 0),
  );

  const pnlSeries = useTraderPnlSeries({
    traders,
    selectableTraders,
    reloadAnalytics: () => reloadAnalyticsRef.current(),
  });

  let analyticsRequestId = 0;

  async function loadAnalytics() {
    const requestId = ++analyticsRequestId;
    try {
      const data = await fetchTraderAnalytics({
        watchlistSimOnly: watchlistOnly(),
      });
      if (requestId !== analyticsRequestId) return;
      setTraders(data.traders);
      setPnlByCategory(data.pnlByCategory);
    } catch {
      // Keep previous values on transient errors.
    } finally {
      if (requestId === analyticsRequestId) {
        setLoading(false);
      }
    }
  }
  reloadAnalyticsRef.current = loadAnalytics;

  createEffect(() => {
    watchlistOnly();
    void loadAnalytics();
  });

  onMount(() => {
    const socket = connectSocket();
    const refresh = debounceFn(() => void loadAnalytics(), REFRESH_DEBOUNCE_MS);
    socket.on('pnl_tick', refresh);
    socket.on('position_update', refresh);
    socket.on('simulation_reset', refresh);
    socket.on('simulation_snapshot_created', refresh);
    onCleanup(() => {
      socket.off('pnl_tick', refresh);
      socket.off('position_update', refresh);
      socket.off('simulation_reset', refresh);
      socket.off('simulation_snapshot_created', refresh);
      refresh.cancel();
    });
  });

  const sortedTraders = createMemo(() =>
    [...filteredTraders()].sort((a, b) =>
      compareTraders(a, b, sortKey(), sortDir()),
    ),
  );

  const totals = createMemo(() => aggregateTraderAnalyticsTotals(filteredTraders()));

  const rankScale = createMemo(() => {
    const values = sortedTraders().map((t) => Math.abs(t.totalPnl));
    return Math.max(...values, 1);
  });

  const tradersWithActivity = createMemo(() =>
    sortedTraders().filter((t) => t.positionCount > 0),
  );

  const categoryScopeLabel = createMemo(() =>
    watchlistOnly() ? 'Watchlist sim' : 'Tous les traders',
  );

  function toggleSort(key: SortKey) {
    if (sortKey() === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortKey(key);
    setSortDir(defaultSortDirForKey(key));
  }

  return (
    <>
    <Show
      when={!props.algoKind || props.algoKind === 'copy'}
      fallback={
        <section class="panel">
          <div class="panel-header">
            <h2>Analytics par trader</h2>
          </div>
          <div class="empty-state">
            Les analytics par trader (copy trading) ne sont pas disponibles pour l'algo{' '}
            {props.algoKind ? ALGO_LABEL[props.algoKind] : ''}. Sélectionnez l'onglet Copy.
          </div>
        </section>
      }
    >
    <section class="panel">
      <div class="panel-header">
        <h2>Analytics par trader</h2>
        <div class="panel-header-actions">
          <div class="sim-analytics-filter">
            <button
              type="button"
              class={`btn btn-sm ${watchlistOnly() ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setWatchlistOnly(true)}
            >
              Watchlist sim
            </button>
            <button
              type="button"
              class={`btn btn-sm ${!watchlistOnly() ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setWatchlistOnly(false)}
            >
              Tous
            </button>
          </div>
          <span class="panel-count">
            {filteredTraders().length} trader
            {filteredTraders().length !== 1 ? 's' : ''}
          </span>
          <button
            type="button"
            class="panel-collapse-btn"
            onClick={() => setCollapsed((c) => !c)}
            title={collapsed() ? 'Déplier' : 'Plier'}
          >
            <Icon name={collapsed() ? 'chevron-down' : 'chevron-up'} />
          </button>
        </div>
      </div>

      <CollapsiblePanel collapsed={collapsed()}>
        <Show
          when={!loading() || traders().length > 0}
          fallback={<div class="empty-state">Chargement…</div>}
        >
          <div class="panel-body sim-analytics-panel">
            <Show
              when={tradersWithActivity().length > 0}
              fallback={
                <div class="empty-state">
                  <div class="empty-state-icon">◈</div>
                  <p>Aucune position sim copiée pour le moment.</p>
                  <p class="form-hint">
                    Les performances apparaîtront dès qu'un trader sim ouvrira
                    une position.
                  </p>
                </div>
              }
            >
              <section class="sim-analytics-rank">
                <h3 class="sim-analytics-section-title">Classement PnL total</h3>
                <For each={sortedTraders().filter((t) => t.totalPnl !== 0 || t.positionCount > 0)}>
                  {(trader) => {
                    const width = () =>
                      `${(Math.abs(trader.totalPnl) / rankScale()) * 100}%`;
                    return (
                      <div class="sim-analytics-rank-row">
                        <span class="sim-analytics-rank-label">
                          {traderDisplayName(trader)}
                        </span>
                        <div class="sim-analytics-rank-bar-wrap">
                          <div
                            class="sim-analytics-rank-bar"
                            classList={{
                              'is-positive': trader.totalPnl > 0,
                              'is-negative': trader.totalPnl < 0,
                            }}
                            style={{ width: width() }}
                          />
                        </div>
                        <span class={`sim-analytics-rank-value ${pnlClass(trader.totalPnl)}`}>
                          {formatPnlAmount(trader.totalPnl, true)}
                        </span>
                      </div>
                    );
                  }}
                </For>
              </section>

              <SimAnalyticsCategoryChart
                rows={pnlByCategory()}
                scopeLabel={categoryScopeLabel()}
              />

              <SimAnalyticsChartSection
                selectableTraders={selectableTraders()}
                marketOptions={pnlSeries.marketOptions()}
                selectedWatchlistId={pnlSeries.selectedWatchlistId()}
                selectedConditionId={pnlSeries.selectedConditionId()}
                onSelectTrader={pnlSeries.selectTrader}
                onSelectConditionId={pnlSeries.setSelectedConditionId}
                pnlSeries={pnlSeries.pnlSeries()}
                seriesLoading={pnlSeries.seriesLoading()}
                seriesHint={pnlSeries.seriesHint()}
                currentTotalPnl={pnlSeries.currentTotalPnl()}
                currentPnlScopeLabel={pnlSeries.currentPnlScopeLabel()}
              />

              <SimAnalyticsTable
                traders={sortedTraders()}
                totals={totals()}
                sortKey={sortKey()}
                sortDir={sortDir()}
                selectedWatchlistId={pnlSeries.selectedWatchlistId()}
                onToggleSort={toggleSort}
                onSelectTrader={pnlSeries.selectTrader}
              />
            </Show>
          </div>
        </Show>
      </CollapsiblePanel>
    </section>
    <SimMarketAnalyticsPanel />
    </Show>
    </>
  );
}
