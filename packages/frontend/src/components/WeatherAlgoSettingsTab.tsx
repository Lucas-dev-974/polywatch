import { createSignal, Show, onMount } from 'solid-js';
import {
  fetchWeatherConfig,
  updateWeatherConfig,
  type WeatherConfig,
} from '../api';
import {
  NumberField,
  ToggleField,
} from './settings-fields';
import { CollapsibleSection } from './CollapsibleSection';

export function WeatherAlgoSettingsTab() {
  const [config, setConfig] = createSignal<WeatherConfig | null>(null);
  const [saving, setSaving] = createSignal(false);
  const [loaded, setLoaded] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  async function loadConfig() {
    try {
      setConfig(await fetchWeatherConfig());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Chargement impossible');
    }
    setLoaded(true);
  }

  async function saveConfig() {
    const c = config();
    if (!c) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await updateWeatherConfig({
        weatherAlgoEnabled: c.weatherAlgoEnabled,
        weatherAlgoSimEnabled: c.weatherAlgoSimEnabled,
        weatherAlgoRealEnabled: c.weatherAlgoRealEnabled,
        weatherAlgoSelectionMode: c.weatherAlgoSelectionMode,
        weatherAlgoMaxSignalsPerEvent: c.weatherAlgoMaxSignalsPerEvent,
        weatherAlgoPollMs: c.weatherAlgoPollMs,
        simInitialCapitalWeather: c.simInitialCapitalWeather,
        weatherAlgoForecastHistoryRecordingEnabled: c.weatherAlgoForecastHistoryRecordingEnabled,
        weatherAlgoMarketSnapshotRecordingEnabled: c.weatherAlgoMarketSnapshotRecordingEnabled,
        weatherAlgoEvaluationLogRecordingEnabled: c.weatherAlgoEvaluationLogRecordingEnabled,
        weatherAlgoForecastHistoryRetentionDays: c.weatherAlgoForecastHistoryRetentionDays,
        weatherAlgoMarketSnapshotRetentionDays: c.weatherAlgoMarketSnapshotRetentionDays,
        weatherAlgoEvaluationLogRetentionDays: c.weatherAlgoEvaluationLogRetentionDays,
      });
      const { sessionRotation: _sessionRotation, ...cfg } = updated as WeatherConfig & {
        sessionRotation?: unknown;
      };
      setConfig(cfg);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sauvegarde impossible');
    }
    setSaving(false);
  }

  onMount(() => void loadConfig());

  function update<K extends keyof WeatherConfig>(key: K, value: WeatherConfig[K]) {
    setConfig((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  return (
    <CollapsibleSection
      title="Paramètres Weather Algo"
      persistKey="polywatch_weather_settings_collapsed"
      headerActions={
        <button class="btn btn-sm btn-primary" onClick={() => saveConfig()} disabled={saving()}>
          {saving() ? '...' : 'Sauvegarder'}
        </button>
      }
    >
      <p class="form-hint">
        Les réglages de trading (gates d’entrée, sizing, sortie, SL/TP/trailing, limites, kill-switch,
        pre-close) se configurent par stratégie dans l’onglet Stratégies.
      </p>
      <Show when={error()}>
        <p class="form-hint weather-settings-error">{error()}</p>
      </Show>
      <Show when={config()}>
        {(c) => (
          <div class="weather-settings-grid">
            <h3 class="settings-subheading">Activation</h3>
            <ToggleField
              label="Algo activé"
              checked={c().weatherAlgoEnabled}
              hint="Active/désactive les entrées. Les sorties restent évaluées pour les positions ouvertes."
              onChange={(checked) => update('weatherAlgoEnabled', checked)}
            />
            <ToggleField
              label="Mode Simulation actif"
              checked={c().weatherAlgoSimEnabled}
              onChange={(checked) => update('weatherAlgoSimEnabled', checked)}
            />
            <ToggleField
              label="Mode Réel actif"
              checked={c().weatherAlgoRealEnabled}
              hint="Requiert aussi le master kill global realTradingEnabled activé."
              onChange={(checked) => update('weatherAlgoRealEnabled', checked)}
            />

            <h3 class="settings-subheading">Polling</h3>
            <NumberField
              label="Poll (minutes)"
              value={c().weatherAlgoPollMs / 60_000}
              min={1}
              max={1440}
              step={1}
              hint="Cadence d’évaluation des entrées/sorties, en minutes. Minimum 1 minute (60 000 ms). Les polls sont alignés sur une grille horaire UTC (multiple de la période depuis minuit UTC), indépendante de l’heure de démarrage. Les cycles longs peuvent être différés (anti-overlap). Le timer est recréé à chaud après sauvegarde."
              onChange={(minutes) =>
                update('weatherAlgoPollMs', Math.max(10_000, Math.round(minutes * 60_000)))
              }
            />

            <h3 class="settings-subheading">Sélection entre villes</h3>
            <div class="form-field">
              <label>Mode de sélection (entre villes)</label>
              <select
                class="select"
                value={c().weatherAlgoSelectionMode}
                onChange={(e) => update('weatherAlgoSelectionMode', e.currentTarget.value)}
              >
                <option value="single">Single (meilleure ville)</option>
                <option value="multi">Multi (top N villes)</option>
              </select>
            </div>
            <NumberField
              label="Max villes (mode multi)"
              value={c().weatherAlgoMaxSignalsPerEvent}
              min={1}
              max={20}
              step={1}
              onChange={(value) => update('weatherAlgoMaxSignalsPerEvent', value)}
            />

            <h3 class="settings-subheading">Capital sim</h3>
            <NumberField
              label="Capital initial sim weather (pUSD)"
              value={c().simInitialCapitalWeather}
              min={0}
              step={1}
              hint="Changer cette valeur peut déclencher une rotation de session sim."
              onChange={(value) => update('simInitialCapitalWeather', value)}
            />

            <h3 class="settings-subheading">Enregistrement données backtest</h3>
            <ToggleField
              label="Historique forecasts"
              checked={c().weatherAlgoForecastHistoryRecordingEnabled}
              hint="Append-only à chaque fetch Open-Meteo réel (pas cache hit)."
              onChange={(checked) => update('weatherAlgoForecastHistoryRecordingEnabled', checked)}
            />
            <ToggleField
              label="Snapshots marché + bucket ticks"
              checked={c().weatherAlgoMarketSnapshotRecordingEnabled}
              hint="Prix YES/NO de chaque bucket actif, à chaque cycle d'évaluation."
              onChange={(checked) => update('weatherAlgoMarketSnapshotRecordingEnabled', checked)}
            />
            <ToggleField
              label="Journal d'évaluation"
              checked={c().weatherAlgoEvaluationLogRecordingEnabled}
              hint="Décisions signal/abstain par bucket × stratégie."
              onChange={(checked) => update('weatherAlgoEvaluationLogRecordingEnabled', checked)}
            />
            <NumberField
              label="Rétention forecast history (jours)"
              value={c().weatherAlgoForecastHistoryRetentionDays}
              min={1}
              max={365}
              step={1}
              onChange={(value) => update('weatherAlgoForecastHistoryRetentionDays', value)}
            />
            <NumberField
              label="Rétention snapshots (jours)"
              value={c().weatherAlgoMarketSnapshotRetentionDays}
              min={1}
              max={365}
              step={1}
              onChange={(value) => update('weatherAlgoMarketSnapshotRetentionDays', value)}
            />
            <NumberField
              label="Rétention evaluation log (jours)"
              value={c().weatherAlgoEvaluationLogRetentionDays}
              min={1}
              max={365}
              step={1}
              onChange={(value) => update('weatherAlgoEvaluationLogRetentionDays', value)}
            />
          </div>
        )}
      </Show>
    </CollapsibleSection>
  );
}
