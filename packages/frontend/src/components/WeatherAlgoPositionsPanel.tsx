import { For, Show } from 'solid-js';
import type { useWeatherAlgoPositions } from '../hooks/useWeatherAlgoPositions';

type PositionsState = ReturnType<typeof useWeatherAlgoPositions>;

export interface WeatherAlgoPositionsPanelProps {
  positions: PositionsState;
}

export function WeatherAlgoPositionsPanel(props: WeatherAlgoPositionsPanelProps) {
  const p = () => props.positions;
  return (
    <section class="algo-panel algo-panel-full">
      <div class="algo-panel-header">
        <h2 class="algo-panel-title">Positions weather-algo</h2>
        <span class="algo-panel-count">{p().positions().length} ouvertes</span>
      </div>
      <Show when={!p().loading()} fallback={<div class="algo-empty">Chargement…</div>}>
        <Show when={p().positions().length > 0} fallback={<div class="algo-empty">Aucune position ouverte.</div>}>
          <For each={p().positions()}>
            {(pos) => (
              <div class="weather-position-row">
                <span>{pos.outcome}</span>
                <span>Qté: {pos.quantity}</span>
                <span>Entrée: {pos.entryPrice}</span>
                <span>PnL: {pos.unrealizedPnl.toFixed(2)}</span>
                <button class="btn btn-sm btn-ghost" onClick={() => p().closePosition(pos.id)}>
                  Fermer
                </button>
              </div>
            )}
          </For>
        </Show>
      </Show>
    </section>
  );
}