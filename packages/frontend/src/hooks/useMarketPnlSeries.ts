import { createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import type { Accessor } from 'solid-js';
import {
  updateLivePnlSeriesPoint,
} from '@polywatch/core/simulation/trader-pnl-series';
import { debounceFn } from '../lib/debounce';
import {
  fetchMarketPnlSeries,
  type MarketAnalyticsRow,
  type MarketPnlSeriesResponse,
} from '../lib/market-analytics';
import { connectSocket } from '../socket';

const REFRESH_DEBOUNCE_MS = 500;
const MARKET_REFRESH_DEBOUNCE_MS = 3_000;

export function useMarketPnlSeries(options: {
  markets: Accessor<MarketAnalyticsRow[]>;
  reloadAnalytics: () => Promise<void>;
}) {
  const [selectedConditionId, setSelectedConditionId] = createSignal<string | null>(null);
  const [pnlSeries, setPnlSeries] = createSignal<MarketPnlSeriesResponse['points']>([]);
  const [currentTotalPnl, setCurrentTotalPnl] = createSignal(0);
  const [seriesLoading, setSeriesLoading] = createSignal(false);
  const [seriesHint, setSeriesHint] = createSignal<string | null>(null);
  let seriesRequestId = 0;

  async function loadPnlSeries(loadOptions?: { silent?: boolean }) {
    const conditionId = selectedConditionId();
    if (conditionId == null) {
      setPnlSeries([]);
      setSeriesHint('Sélectionnez un marché.');
      return;
    }

    const requestId = ++seriesRequestId;
    if (!loadOptions?.silent) {
      setSeriesLoading(true);
    }
    try {
      const data = await fetchMarketPnlSeries(conditionId);
      if (requestId !== seriesRequestId) return;
      setPnlSeries(data.points);
      setCurrentTotalPnl(data.currentTotalPnl);
      const snapshotPoints = data.points.filter((p) => !p.live);
      setSeriesHint(
        snapshotPoints.length === 0
          ? 'Aucun snapshot — activez les snapshots auto ou créez-en un manuellement.'
          : null,
      );
    } catch {
      if (requestId !== seriesRequestId) return;
      setSeriesHint('Impossible de charger la courbe PnL.');
    } finally {
      if (requestId === seriesRequestId) {
        setSeriesLoading(false);
      }
    }
  }

  function syncLivePointFromAnalytics() {
    const conditionId = selectedConditionId();
    if (conditionId == null) return;

    const market = options.markets().find((m) => m.conditionId === conditionId);
    if (!market) return;

    setCurrentTotalPnl(market.totalPnl);
    setPnlSeries((prev) =>
      updateLivePnlSeriesPoint(prev, market.totalPnl),
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
    const conditionId = selectedConditionId();
    if (conditionId == null) return;
    const markets = options.markets();
    if (markets.length > 0 && !markets.some((m) => m.conditionId === conditionId)) {
      setSelectedConditionId(null);
    }
  });

  createEffect(() => {
    selectedConditionId();
    void loadPnlSeries();
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

  const currentPnlScopeLabel = createMemo(() =>
    selectedConditionId() ? ' sur ce marché' : ' (tous marchés)',
  );

  return {
    selectedConditionId,
    setSelectedConditionId,
    pnlSeries,
    currentTotalPnl,
    seriesLoading,
    seriesHint,
    currentPnlScopeLabel,
  };
}
