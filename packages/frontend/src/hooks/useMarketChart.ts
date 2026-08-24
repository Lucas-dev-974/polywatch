import { createEffect, createSignal, onCleanup } from 'solid-js';
import type { AlgoChartTickUpdate } from '@polywatch/core/lib/algo-price-tick.types';
import {
  fetchMarketChart,
  genericPointToUpDownPricePoint,
  type OutcomeSideLabels,
  type UpDownPricePoint,
} from '../lib/market-chart';
import { api } from '../api';
import { connectSocket } from '../socket';

interface GenericMarketChartResponse {
  conditionId: string;
  points: {
    t: number;
    bestBid: number | null;
    bestAsk: number | null;
    midPrice: number | null;
    spread: number | null;
    spreadPercent: number | null;
    lastTradePrice: number | null;
    metrics?: {
      openPositionsCount: number;
      openExposureUsd: number | null;
      unrealizedPnl: number | null;
    } | null;
  }[];
  outcomeLabels?: OutcomeSideLabels | null;
}

function appendChartTick(
  points: UpDownPricePoint[],
  tick: AlgoChartTickUpdate,
): UpDownPricePoint[] {
  const last = points[points.length - 1];
  if (last && tick.t <= last.t) return points;
  return [
    ...points,
    {
      t: tick.t,
      up: tick.up,
      down: tick.down,
      ...(tick.metrics ? { metrics: tick.metrics } : {}),
    },
  ];
}

export function useMarketChart(
  conditionId: string,
  isCryptoUpDown = false,
  assetId?: string | null,
  timeframe?: () => string,
) {
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);
  const [points, setPoints] = createSignal<UpDownPricePoint[]>([]);
  const [outcomeLabels, setOutcomeLabels] = createSignal<OutcomeSideLabels | null>(null);
  const [liveEnabled, setLiveEnabled] = createSignal(false);

  async function reload(options?: { silent?: boolean }) {
    const silent = options?.silent ?? false;
    if (!silent) {
      setLoading(true);
      setError(null);
      setPoints([]);
      setOutcomeLabels(null);
    }
    const tf = timeframe?.();
    try {
      if (isCryptoUpDown) {
        const data = await fetchMarketChart(conditionId, tf);
        if (!Array.isArray(data.points)) {
          throw new Error('Réponse serveur invalide');
        }
        setPoints(data.points);
        setOutcomeLabels(data.outcomeLabels ?? null);
      } else {
        const params = new URLSearchParams();
        if (assetId) params.set('assetId', assetId);
        if (tf && tf !== 'max') params.set('timeframe', tf);
        const qs = params.toString();
        const url = `/market-chart/${encodeURIComponent(conditionId)}${qs ? `?${qs}` : ''}`;
        const data = await api<GenericMarketChartResponse>(url);
        if (!Array.isArray(data.points)) {
          throw new Error('Réponse serveur invalide');
        }
        setPoints(data.points.map(genericPointToUpDownPricePoint));
        setOutcomeLabels(data.outcomeLabels ?? null);
      }
      if (silent) {
        setError(null);
      }
    } catch (e) {
      if (!silent) {
        setError(
          e instanceof Error ? e.message : 'Impossible de charger le graphique',
        );
        setPoints([]);
      }
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }

  createEffect(() => {
    void timeframe?.();
    void reload();
  });

  createEffect(() => {
    if (!liveEnabled() || !isCryptoUpDown) return;

    const socket = connectSocket();
    const targetConditionId = conditionId;

    const onTick = (tick: AlgoChartTickUpdate) => {
      if (tick.conditionId !== targetConditionId) return;
      setPoints((current) => appendChartTick(current, tick));
    };

    const onReconnect = () => {
      void reload({ silent: true });
    };

    socket.on('algo_chart_tick', onTick);
    socket.on('connect', onReconnect);

    onCleanup(() => {
      socket.off('algo_chart_tick', onTick);
      socket.off('connect', onReconnect);
    });
  });

  createEffect(() => {
    if (!isCryptoUpDown && liveEnabled()) {
      setLiveEnabled(false);
    }
  });

  return { loading, error, points, outcomeLabels, reload, liveEnabled, setLiveEnabled };
}
