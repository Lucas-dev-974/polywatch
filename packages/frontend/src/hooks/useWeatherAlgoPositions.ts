import { createSignal, onCleanup, onMount } from 'solid-js';
import { api } from '../api';

interface WeatherPosition {
  id: number;
  conditionId: string;
  assetId: string;
  outcome: string;
  quantity: number;
  entryPrice: number;
  status: string;
  mode: string;
  unrealizedPnl: number;
  reason: string | null;
}

const POLL_MS = 10_000;

export function useWeatherAlgoPositions() {
  const [positions, setPositions] = createSignal<WeatherPosition[]>([]);
  const [loading, setLoading] = createSignal(true);

  async function refresh() {
    try {
      // CopiedPosition doesn't have traderAddress — filter by reason prefix.
      // Weather-algo positions have reason 'WEATHER_OPEN' or 'WEATHER_FORECAST_CHANGE'.
      const data = await api<WeatherPosition[]>('/copied-positions?status=open');
      setPositions(data.filter((p) =>
        p.reason != null && p.reason.startsWith('WEATHER_')
      ));
    } catch { /* ignore */ }
    setLoading(false);
  }

  async function closePosition(id: number) {
    await api(`/copied-positions/${id}/close`, { method: 'POST' });
    await refresh();
  }

  onMount(() => {
    void refresh();
    const poll = setInterval(() => void refresh(), POLL_MS);
    onCleanup(() => clearInterval(poll));
  });

  return { positions, loading, closePosition, refresh };
}