import { createSignal, For, Show } from 'solid-js';
import type { AutoTrackRule } from '../hooks/useWeatherAlgoDashboard';

export interface WeatherAlgoAutoTrackTabProps {
  rules: AutoTrackRule[];
  onAdd: (city: string, lookAheadDays: number) => void;
  onRemove: (id: number) => void;
  onToggle: (id: number, enabled: boolean) => void;
}

export function WeatherAlgoAutoTrackTab(props: WeatherAlgoAutoTrackTabProps) {
  const [city, setCity] = createSignal('');
  const [lookAhead, setLookAhead] = createSignal(1);

  return (
    <section class="algo-panel">
      <div class="algo-panel-header">
        <h2 class="algo-panel-title">Villes surveillées</h2>
      </div>
      <p class="form-hint weather-autotrack-note">
        Surveillez une ville : l’algo choisit automatiquement le palier de température
        (température max) aligné sur la prévision Open-Meteo, puis achète YES si l’edge est suffisant.
        Une seule position ouverte par ville.
      </p>
      <div class="weather-autotrack-form">
        <input
          type="text"
          placeholder="Ville (ex: Paris)"
          value={city()}
          onInput={(e) => setCity(e.currentTarget.value)}
        />
        <label class="weather-autotrack-lookahead">
          Horizon (jours)
          <input
            type="number"
            min="1"
            max="30"
            value={lookAhead()}
            onInput={(e) => setLookAhead(Number(e.currentTarget.value) || 1)}
          />
        </label>
        <button
          class="btn btn-sm btn-primary"
          onClick={() => {
            if (city().trim()) {
              props.onAdd(city().trim(), lookAhead());
              setCity('');
            }
          }}
        >
          + Surveiller
        </button>
      </div>
      <Show when={props.rules.length === 0}>
        <div class="algo-empty">Aucune ville surveillée.</div>
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
