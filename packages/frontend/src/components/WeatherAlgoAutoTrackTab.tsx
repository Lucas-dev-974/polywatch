import { createSignal, Show } from 'solid-js';
import type { AutoTrackRule } from '../hooks/useWeatherAlgoDashboard';
import { CollapsibleSection } from './CollapsibleSection';
import { WeatherWatchedTable } from './weather/WeatherWatchedTable';

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
      <WeatherWatchedTable
        rules={props.rules}
        onToggle={props.onToggle}
        onRemove={props.onRemove}
        renderHorizon={(rule) => (
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
        )}
        emptyText="Ajoutez une ville ci-dessus pour commencer à suivre les conditions météo."
      />
    </CollapsibleSection>
  );
}
