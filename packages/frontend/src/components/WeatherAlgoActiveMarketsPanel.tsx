import { For, Show } from 'solid-js';
import type { WeatherSelection } from '../hooks/useWeatherAlgoDashboard';
import { groupByCity } from '../lib/weather-grouping';
import { WeatherCityGroup } from './WeatherCityGroup';

export interface WeatherAlgoActiveMarketsPanelProps {
  selections: WeatherSelection[];
  onToggle: (conditionId: string, enabled: boolean) => void;
  onRemove: (conditionId: string) => void;
}

export function WeatherAlgoActiveMarketsPanel(props: WeatherAlgoActiveMarketsPanelProps) {
  const groups = () => groupByCity(props.selections, (s) => s.city);

  return (
    <section class="algo-panel">
      <div class="algo-panel-header">
        <h2 class="algo-panel-title">Marchés suivis ({props.selections.length})</h2>
      </div>

      <Show when={props.selections.length === 0}>
        <div class="algo-empty">Aucun marché suivi. Découvrez et ajoutez des marchés ci-dessous.</div>
      </Show>

      <For each={groups()}>
        {(group) => (
          <WeatherCityGroup
            city={group.city}
            markets={group.items}
            forecastMean={null}
            forecastStatus="unavailable"
            defaultExpanded={true}
            renderItem={(sel: WeatherSelection) => (
              <div class="weather-selection-card" classList={{ 'weather-selection-card--disabled': !sel.enabled }}>
                <div class="weather-selection-card__header">
                  <Show when={sel.targetValue != null}>
                    <span class="weather-selection-card__temp">{sel.targetValue}°C</span>
                  </Show>
                  <Show when={sel.metric}>
                    <span class="weather-selection-card__metric">{sel.metric}</span>
                  </Show>
                </div>
                <div class="weather-selection-card__question">{sel.question}</div>
                <div class="weather-selection-card__actions">
                  <button class="btn btn-sm btn-ghost" onClick={() => props.onToggle(sel.conditionId, !sel.enabled)}>
                    {sel.enabled ? 'Désactiver' : 'Activer'}
                  </button>
                  <button class="btn btn-sm btn-ghost" onClick={() => props.onRemove(sel.conditionId)}>
                    Supprimer
                  </button>
                </div>
              </div>
            )}
          />
        )}
      </For>
    </section>
  );
}
