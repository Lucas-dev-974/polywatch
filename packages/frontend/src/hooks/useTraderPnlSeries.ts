import { createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import type { Accessor } from 'solid-js';
import {
  updateLivePnlSeriesPoint,
  TRADER_PNL_SERIES_HINTS,
} from '@polywatch/core/simulation/trader-pnl-series';
import { debounceFn } from '../lib/debounce';
import {
  fetchTraderPnlSeries,
  type TraderAnalyticsRow,
  type TraderMarketOption,
  type TraderPnlSeriesPoint,
} from '../lib/trader-analytics';
import { connectSocket } from '../socket';

const REFRESH_DEBOUNCE_MS = 500;
const MARKET_REFRESH_DEBOUNCE_MS = 3_000;

export function useTraderPnlSeries(options: {
  traders: Accessor<TraderAnalyticsRow[]>;
  selectableTraders: Accessor<TraderAnalyticsRow[]>;
  reloadAnalytics: () => Promise<void>;
}) {
  const [selectedWatchlistId, setSelectedWatchlistId] = createSignal<number | null>(
    null,
  );
  const [selectedConditionId, setSelectedConditionId] = createSignal<string | null>(
    null,
  );
  const [pnlSeries, setPnlSeries] = createSignal<TraderPnlSeriesPoint[]>([]);
  const [marketOptions, setMarketOptions] = createSignal<TraderMarketOption[]>([]);
  const [currentTotalPnl, setCurrentTotalPnl] = createSignal(0);
  const [seriesLoading, setSeriesLoading] = createSignal(false);
  const [seriesHint, setSeriesHint] = createSignal<string | null>(null);
  let seriesRequestId = 0;

  async function loadPnlSeries(loadOptions?: { silent?: boolean }) {
    const watchlistId = selectedWatchlistId();
    if (watchlistId == null) {
      setPnlSeries([]);
      setMarketOptions([]);
      setSeriesHint(TRADER_PNL_SERIES_HINTS.selectTrader);
      return;
    }

    const requestId = ++seriesRequestId;
    if (!loadOptions?.silent) {
      setSeriesLoading(true);
    }
    try {
      const data = await fetchTraderPnlSeries(
        watchlistId,
        selectedConditionId(),
      );
      if (requestId !== seriesRequestId) return;
      setPnlSeries(data.points);
      setMarketOptions(data.markets);
      setCurrentTotalPnl(data.currentTotalPnl);
      const snapshotPoints = data.points.filter((p) => !p.live);
      setSeriesHint(
        snapshotPoints.length === 0
          ? TRADER_PNL_SERIES_HINTS.noSnapshots
          : null,
      );
    } catch {
      if (requestId !== seriesRequestId) return;
      setSeriesHint(TRADER_PNL_SERIES_HINTS.loadError);
    } finally {
      if (requestId === seriesRequestId) {
        setSeriesLoading(false);
      }
    }
  }

  function syncLivePointFromAnalytics() {
    const watchlistId = selectedWatchlistId();
    if (watchlistId == null) return;

    if (selectedConditionId() != null) {
      void loadPnlSeries({ silent: true });
      return;
    }

    const trader = options.traders().find((t) => t.watchlistId === watchlistId);
    if (!trader) return;

    setCurrentTotalPnl(trader.totalPnl);
    setPnlSeries((prev) =>
      updateLivePnlSeriesPoint(prev, trader.totalPnl),
    );
  }

  const refreshSeries = debounceFn(
    () => void loadPnlSeries({ silent: true }),
    REFRESH_DEBOUNCE_MS,
  );

  const refreshOnMarketTick = debounceFn(
    () => void loadPnlSeries({ silent: true }),
    MARKET_REFRESH_DEBOUNCE_MS,
  );

  const refreshOnPnlTick = debounceFn(async () => {
    await options.reloadAnalytics();
    if (selectedConditionId() != null) {
      refreshOnMarketTick();
      return;
    }
    syncLivePointFromAnalytics();
  }, REFRESH_DEBOUNCE_MS);

  createEffect(() => {
    const selectable = options.selectableTraders();
    const current = selectedWatchlistId();
    if (selectable.length === 0) {
      setSelectedWatchlistId(null);
      return;
    }
    if (current == null || !selectable.some((t) => t.watchlistId === current)) {
      setSelectedWatchlistId(selectable[0]!.watchlistId);
    }
  });

  createEffect(() => {
    selectedWatchlistId();
    selectedConditionId();
    void loadPnlSeries();
  });

  createEffect(() => {
    const conditionId = selectedConditionId();
    if (conditionId == null) return;
    const markets = marketOptions();
    if (markets.length > 0 && !markets.some((m) => m.conditionId === conditionId)) {
      setSelectedConditionId(null);
    }
  });

  onMount(() => {
    const socket = connectSocket();

    const onSimulationReset = () => {
      void options.reloadAnalytics();
      void loadPnlSeries();
    };
    const onSnapshotCreated = () => {
      void options.reloadAnalytics();
      refreshSeries();
    };

    socket.on('pnl_tick', refreshOnPnlTick);
    socket.on('position_update', refreshOnPnlTick);
    socket.on('simulation_reset', onSimulationReset);
    socket.on('simulation_snapshot_created', onSnapshotCreated);
    onCleanup(() => {
      socket.off('pnl_tick', refreshOnPnlTick);
      socket.off('position_update', refreshOnPnlTick);
      socket.off('simulation_reset', onSimulationReset);
      socket.off('simulation_snapshot_created', onSnapshotCreated);
      refreshSeries.cancel();
      refreshOnPnlTick.cancel();
      refreshOnMarketTick.cancel();
    });
  });

  function selectTrader(watchlistId: number | null) {
    if (watchlistId == null) return;
    setSelectedWatchlistId(watchlistId);
  }

  const currentPnlScopeLabel = createMemo(() =>
    selectedConditionId() ? ' sur ce marché' : ' (tous marchés)',
  );

  return {
    selectedWatchlistId,
    selectedConditionId,
    setSelectedConditionId,
    pnlSeries,
    marketOptions,
    currentTotalPnl,
    seriesLoading,
    seriesHint,
    selectTrader,
    currentPnlScopeLabel,
  };
}
