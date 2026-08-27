import {
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { debounceFn } from '../../lib/debounce';
import {
  compareMarkets,
  defaultSortDirForKey,
  type MarketSortDir,
  type MarketSortKey,
} from '../../lib/market-analytics-sort';
import {
  aggregateMarketAnalyticsTotals,
  fetchMarketAnalytics,
  type MarketAnalyticsRow,
} from '../../lib/market-analytics';
import { connectSocket } from '../../socket';
import { useMarketPnlSeries } from '../../hooks/useMarketPnlSeries';
import { CollapsiblePanel, useCollapse } from '../CollapsiblePanel';
import { Icon } from '../Icon';
import { SimMarketAnalyticsRank } from '../sim/SimMarketAnalyticsRank';
import { SimMarketAnalyticsChartSection } from '../sim/SimMarketAnalyticsChartSection';
import { SimMarketAnalyticsTable } from '../sim/SimMarketAnalyticsTable';
import { SimMarketYesNoBreakdown } from '../sim/SimMarketYesNoBreakdown';

const REFRESH_DEBOUNCE_MS = 500;

export function SimMarketAnalyticsPanel() {
  const [collapsed, setCollapsed] = useCollapse();
  const [markets, setMarkets] = createSignal<MarketAnalyticsRow[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [watchlistOnly, setWatchlistOnly] = createSignal(true);
  const [sortKey, setSortKey] = createSignal<MarketSortKey>('totalPnl');
  const [sortDir, setSortDir] = createSignal<MarketSortDir>('desc');

  const reloadAnalyticsRef: { current: () => Promise<void> } = {
    current: async () => {},
  };

  const pnlSeries = useMarketPnlSeries({
    markets,
    reloadAnalytics: () => reloadAnalyticsRef.current(),
  });

  let analyticsRequestId = 0;

  async function loadAnalytics() {
    const requestId = ++analyticsRequestId;
    try {
      const data = await fetchMarketAnalytics({
        watchlistSimOnly: watchlistOnly(),
      });
      if (requestId !== analyticsRequestId) return;
      setMarkets(data.markets);
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

  const sortedMarkets = createMemo(() =>
    [...markets()].sort((a, b) =>
      compareMarkets(a, b, sortKey(), sortDir()),
    ),
  );

  const totals = createMemo(() => aggregateMarketAnalyticsTotals(markets()));

  const marketsWithActivity = createMemo(() =>
    sortedMarkets().filter((m) => m.positionCount > 0),
  );

  function toggleSort(key: MarketSortKey) {
    if (sortKey() === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortKey(key);
    setSortDir(defaultSortDirForKey(key));
  }

  return (
    <section class="panel">
      <div class="panel-header">
        <h2>Analytics par marché</h2>
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
            {markets().length} marché
            {markets().length !== 1 ? 's' : ''}
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
          when={!loading() || markets().length > 0}
          fallback={<div class="empty-state">Chargement…</div>}
        >
          <div class="panel-body sim-analytics-panel">
            <Show
              when={marketsWithActivity().length > 0}
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
              <SimMarketAnalyticsRank markets={sortedMarkets()} />

              <SimMarketAnalyticsChartSection
                markets={marketsWithActivity()}
                selectedConditionId={pnlSeries.selectedConditionId()}
                onSelectConditionId={pnlSeries.setSelectedConditionId}
                pnlSeries={pnlSeries.pnlSeries()}
                seriesLoading={pnlSeries.seriesLoading()}
                seriesHint={pnlSeries.seriesHint()}
                currentTotalPnl={pnlSeries.currentTotalPnl()}
                currentPnlScopeLabel={pnlSeries.currentPnlScopeLabel()}
              />

              <SimMarketYesNoBreakdown
                markets={marketsWithActivity()}
                selectedConditionId={pnlSeries.selectedConditionId()}
              />

              <SimMarketAnalyticsTable
                markets={sortedMarkets()}
                totals={totals()}
                sortKey={sortKey()}
                sortDir={sortDir()}
                onToggleSort={toggleSort}
              />
            </Show>
          </div>
        </Show>
      </CollapsiblePanel>
    </section>
  );
}
