import { For, Show } from 'solid-js';
import type { AutoTrackRule } from '../hooks/useWeatherAlgoDashboard';

export interface WeatherAlgoActiveMarketsPanelProps {
  rules: AutoTrackRule[];
  onToggle: (id: number, enabled: boolean) => void;
  onRemove: (id: number) => void;
}

export function WeatherAlgoActiveMarketsPanel(props: WeatherAlgoActiveMarketsPanelProps) {
  return (
    <section class="algo-panel">
      <div class="algo-panel-header">
        <h2 class="algo-panel-title">Villes surveillées ({props.rules.length})</h2>
      </div>

      <Show when={props.rules.length === 0}>
        <div class="algo-empty">
          Aucune ville surveillée. Utilisez la découverte ou l’onglet Villes pour en ajouter.
        </div>
      </Show>

      <For each={props.rules}>
        {(rule) => (
          <div
            class="weather-autotrack-row"
            classList={{ 'weather-autotrack-row--disabled': !rule.enabled }}
          >
            <span>{rule.city}</span>
            <span>Temp max</span>
            <span>J+{rule.lookAheadDays}</span>
            <button
              class="btn btn-sm btn-ghost"
              onClick={() => props.onToggle(rule.id, !rule.enabled)}
            >
              {rule.enabled ? 'Désactiver' : 'Activer'}
            </button>
            <button class="btn btn-sm btn-ghost" onClick={() => props.onRemove(rule.id)}>
              Supprimer
            </button>
          </div>
        )}
      </For>
    </section>
  );
}
