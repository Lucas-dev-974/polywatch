import { createSignal, For, Show } from 'solid-js';
import type { AutoTrackRule } from '../hooks/useWeatherAlgoDashboard';
import { CollapsibleSection } from './CollapsibleSection';
import { formatMetric } from '../lib/weather-metric';

export interface WeatherAlgoAutoTrackTabProps {
  rules: AutoTrackRule[];
  onAdd: (city: string, lookAheadDays: number) => void;
  onRemove: (id: number) => void;
  onToggle: (id: number, enabled: boolean) => void;
  onUpdateLookAhead: (id: number, lookAheadDays: number) => void;
  onUpdateAllLookAhead: (lookAheadDays: number) => void;
}

export function WeatherAlgoAutoTrackTab(props: WeatherAlgoAutoTrackTabProps) {
  const [city, setCity] = createSignal('');
  const [lookAhead, setLookAhead] = createSignal(1);
  const [globalLookAhead, setGlobalLookAhead] = createSignal(1);

  return (
    <CollapsibleSection
      title="Villes surveillées"
      persistKey="polywatch_weather_autotrack_collapsed"
    >
      <p class="form-hint weather-autotrack-note">
        Surveillez une ville : l’algo choisit automatiquement le palier de température
        (température max) aligné sur la prévision Open-Meteo, puis achète YES si l’edge est suffisant.
        Une seule position ouverte par ville.
        L’horizon (jours) définit combien de dates UTC sont évaluées : 1 = aujourd’hui seulement,
        2 = aujourd’hui + demain, etc.
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
      <Show when={props.rules.length > 0}>
        <div class="weather-autotrack-global">
          <label class="weather-autotrack-lookahead">
            Horizon global (jours)
            <input
              type="number"
              min="1"
              max="30"
              value={globalLookAhead()}
              onInput={(e) => setGlobalLookAhead(Number(e.currentTarget.value) || 1)}
            />
          </label>
          <button
            class="btn btn-sm btn-ghost"
            onClick={() => props.onUpdateAllLookAhead(globalLookAhead())}
          >
            Appliquer à toutes
          </button>
        </div>
      </Show>
      <Show
        when={props.rules.length > 0}
        fallback={
          <div class="weather-watched-empty">
            <div class="weather-watched-empty-icon" aria-hidden="true">
              🌍
            </div>
            <p class="weather-watched-empty-title">Aucune ville surveillée</p>
            <p class="weather-watched-empty-text">
              Ajoutez une ville ci-dessus pour commencer à suivre les conditions météo.
            </p>
          </div>
        }
      >
        <div class="weather-watched-table-wrap" role="region" aria-label="Villes surveillées">
          <table class="weather-watched-table">
            <thead>
              <tr>
                <th class="weather-watched-th">Ville</th>
                <th class="weather-watched-th">Métrique</th>
                <th class="weather-watched-th">Horizon</th>
                <th class="weather-watched-th">État</th>
                <th class="weather-watched-th weather-watched-th-actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              <For each={props.rules}>
                {(rule) => (
                  <tr
                    class="weather-watched-tr"
                    classList={{ 'weather-watched-tr--disabled': !rule.enabled }}
                  >
                    <td class="weather-watched-td weather-watched-td-city" data-label="Ville">
                      {rule.city}
                    </td>
                    <td class="weather-watched-td" data-label="Métrique">
                      {formatMetric(rule.metric)}
                    </td>
                    <td class="weather-watched-td" data-label="Horizon">
                      <label class="weather-autotrack-lookahead weather-autotrack-lookahead--inline">
                        <input
                          type="number"
                          min="1"
                          max="30"
                          value={rule.lookAheadDays}
                          onChange={(e) => {
                            const n = Math.max(1, Math.min(30, Math.floor(Number(e.currentTarget.value) || 1)));
                            if (n !== rule.lookAheadDays) {
                              props.onUpdateLookAhead(rule.id, n);
                            }
                          }}
                        />
                        <span>j</span>
                      </label>
                    </td>
                    <td class="weather-watched-td" data-label="État">
                      <span
                        class="weather-watched-badge"
                        classList={{
                          'weather-watched-badge--active': rule.enabled,
                          'weather-watched-badge--inactive': !rule.enabled,
                        }}
                      >
                        <span class="weather-watched-badge-dot" />
                        {rule.enabled ? 'Actif' : 'Inactif'}
                      </span>
                    </td>
                    <td
                      class="weather-watched-td weather-watched-td-actions"
                      data-label="Actions"
                    >
                      <button
                        class="btn btn-sm btn-ghost"
                        onClick={() => props.onToggle(rule.id, !rule.enabled)}
                      >
                        {rule.enabled ? 'Désactiver' : 'Activer'}
                      </button>
                      <button
                        class="btn btn-sm btn-ghost weather-watched-remove"
                        onClick={() => props.onRemove(rule.id)}
                      >
                        Supprimer
                      </button>
                    </td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </div>
      </Show>
    </CollapsibleSection>
  );
}
