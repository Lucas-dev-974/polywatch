import { Show } from 'solid-js';
import type { WeatherStatus } from '../hooks/useWeatherAlgoDashboard';

export interface WeatherAlgoHeaderProps {
  status: WeatherStatus | null;
}

export function WeatherAlgoHeader(props: WeatherAlgoHeaderProps) {
  return (
    <header class="weather-algo-header-v2">
      <div class="weather-algo-title-row">
        <h1 class="page-title-v2">🌤️ Weather Algo</h1>
        <Show when={props.status}>
          {(s) => (
            <span class={`algo-status-badge ${s().alive ? 'alive' : 'stopped'}`}>
              <span class="algo-status-dot" />
              {s().alive ? 'En ligne' : 'Arrêté'}
            </span>
          )}
        </Show>
      </div>
      <Show when={props.status}>
        {(s) => (
          <div class="weather-algo-status-meta">
            <span>Sélections actives: {s().enabledSelections}</span>
            <Show when={s().lastSeenAt}>
              <span>Heartbeat: {new Date(s().lastSeenAt!).toLocaleTimeString()}</span>
            </Show>
            <Show when={s().lastEvaluatedAt}>
              <span>Dernière éval: {new Date(s().lastEvaluatedAt!).toLocaleTimeString()}</span>
            </Show>
            <Show when={s().lastSkipReason}>
              <span class="weather-algo-skip-reason">Skip: {s().lastSkipReason}</span>
            </Show>
          </div>
        )}
      </Show>
    </header>
  );
}