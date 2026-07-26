import { createSignal, For, Show } from 'solid-js';
import type { AutoTrackRule } from '../hooks/useWeatherAlgoDashboard';

export interface WeatherAlgoAutoTrackTabProps {
  rules: AutoTrackRule[];
  onAdd: (city: string, metric: string, lookAheadDays: number, mode: 'expand' | 'city_follow') => void;
  onRemove: (id: number) => void;
  onToggle: (id: number, enabled: boolean) => void;
}

export function WeatherAlgoAutoTrackTab(props: WeatherAlgoAutoTrackTabProps) {
  const [city, setCity] = createSignal('');
  const [metric, setMetric] = createSignal('highest_temp');
  const [lookAhead, setLookAhead] = createSignal(1);
  const [mode, setMode] = createSignal<'expand' | 'city_follow'>('city_follow');

  return (
    <section class="algo-panel">
      <div class="algo-panel-header">
        <h2 class="algo-panel-title">Auto-track rules</h2>
      </div>
      <p class="form-hint weather-autotrack-note">
        Les règles activées ajoutent automatiquement les marchés correspondants aux sélections (sync périodique).
        Le mode "Suivre la ville" sélectionne automatiquement le bon marché selon la prévision météo.
      </p>
      <div class="weather-autotrack-form">
        <input type="text" placeholder="Ville (ex: Jinan)" value={city()}
          onInput={(e) => setCity(e.currentTarget.value)} />
        <select value={metric()} onChange={(e) => setMetric(e.currentTarget.value)}>
          <option value="highest_temp">Temp max</option>
          <option value="lowest_temp">Temp min</option>
        </select>
        <input type="number" min="1" max="30" value={lookAhead()}
          onInput={(e) => setLookAhead(Number(e.currentTarget.value) || 1)} />
        <select value={mode()} onChange={(e) => setMode(e.currentTarget.value as 'expand' | 'city_follow')}>
          <option value="city_follow">Suivre la ville (auto-sélection du marché)</option>
          <option value="expand">Suivre tous les marchés</option>
        </select>
        <button class="btn btn-sm btn-primary" onClick={() => {
          if (city().trim()) { props.onAdd(city().trim(), metric(), lookAhead(), mode()); setCity(''); }
        }}>+ Ajouter</button>
      </div>
      <Show when={props.rules.length === 0}>
        <div class="algo-empty">Aucune règle auto-track.</div>
      </Show>
      <For each={props.rules}>
        {(rule) => (
          <div class="weather-autotrack-row" classList={{ 'weather-autotrack-row--disabled': !rule.enabled }}>
            <span>{rule.city}</span>
            <span>{rule.metric}</span>
            <span>J+{rule.lookAheadDays}</span>
            <span class="weather-autotrack-mode">{rule.mode === 'city_follow' ? 'Ville' : 'Tous'}</span>
            <button class="btn btn-sm btn-ghost" onClick={() => props.onToggle(rule.id, !rule.enabled)}>
              {rule.enabled ? 'Désactiver' : 'Activer'}
            </button>
            <button class="btn btn-sm btn-ghost" onClick={() => props.onRemove(rule.id)}>Supprimer</button>
          </div>
        )}
      </For>
    </section>
  );
}
