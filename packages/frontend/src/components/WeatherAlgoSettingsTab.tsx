import { createSignal, Show } from 'solid-js';
import {
  fetchWeatherConfig,
  updateWeatherConfig,
  type WeatherConfig,
} from '../api';
import {
  KillSwitchField,
  NumberField,
  NullableNumberField,
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
        weatherAlgoKillSwitchAction: c.weatherAlgoKillSwitchAction,
        weatherAlgoMinEdge: c.weatherAlgoMinEdge,
        weatherAlgoMaxForecastStd: c.weatherAlgoMaxForecastStd,
        weatherAlgoEntryUsdc: c.weatherAlgoEntryUsdc,
        weatherAlgoSelectionMode: c.weatherAlgoSelectionMode,
        weatherAlgoMaxSignalsPerEvent: c.weatherAlgoMaxSignalsPerEvent,
        weatherAlgoEntryDepthRetryMax: c.weatherAlgoEntryDepthRetryMax,
        weatherAlgoEntryDepthRetryDelayMs: c.weatherAlgoEntryDepthRetryDelayMs,
        weatherAlgoForecastChangeThreshold: c.weatherAlgoForecastChangeThreshold,
        weatherAlgoCloseBeforeResolutionHours: c.weatherAlgoCloseBeforeResolutionHours,
        weatherAlgoPollMs: c.weatherAlgoPollMs,
        weatherAlgoCityFollowSwitchMode: c.weatherAlgoCityFollowSwitchMode,
        weatherAlgoBucketHysteresisPolls: c.weatherAlgoBucketHysteresisPolls,
        weatherAlgoReentryThrottleMs: c.weatherAlgoReentryThrottleMs,
        weatherAlgoMaxOpenPositions: c.weatherAlgoMaxOpenPositions,
        weatherAlgoMaxExposureUsdc: c.weatherAlgoMaxExposureUsdc,
        weatherAlgoMaxDailyLossUsdc: c.weatherAlgoMaxDailyLossUsdc,
        weatherAlgoMaxPositionSizeUsdc: c.weatherAlgoMaxPositionSizeUsdc,
        weatherAlgoSlConfirmationTicks: c.weatherAlgoSlConfirmationTicks,
        weatherAlgoSlCloseMaxRetries: c.weatherAlgoSlCloseMaxRetries,
        weatherAlgoSlEnabled: c.weatherAlgoSlEnabled,
        weatherAlgoTpEnabled: c.weatherAlgoTpEnabled,
        weatherAlgoTrailingEnabled: c.weatherAlgoTrailingEnabled,
        weatherAlgoSlBidPoints: c.weatherAlgoSlBidPoints,
        weatherAlgoTpBidPoints: c.weatherAlgoTpBidPoints,
        weatherAlgoTrailingBidPoints: c.weatherAlgoTrailingBidPoints,
        weatherAlgoTrailingActivationBidPoints: c.weatherAlgoTrailingActivationBidPoints,
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

  if (!loaded()) void loadConfig();

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
        L’horizon de dates (lookAheadDays) se configure par ville dans l’onglet Villes surveillées.
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
            <KillSwitchField
              value={c().weatherAlgoKillSwitchAction}
              onChange={(value) => update('weatherAlgoKillSwitchAction', value)}
            />

            <h3 class="settings-subheading">Polling & anti-churn</h3>
            <NumberField
              label="Poll (ms)"
              value={c().weatherAlgoPollMs}
              min={10_000}
              max={86_400_000}
              step={1000}
              hint="Cadence d’évaluation des entrées/sorties. Minimum 10 000 ms. Les cycles longs peuvent être différés (anti-overlap). Le timer est recréé à chaud après sauvegarde."
              onChange={(value) => update('weatherAlgoPollMs', value)}
            />
            <NumberField
              label="Hysteresis bucket (polls hors palier)"
              value={c().weatherAlgoBucketHysteresisPolls}
              min={1}
              max={10}
              step={1}
              hint="Nombre de polls consécutifs hors palier avant fermeture (close_and_reenter)."
              onChange={(value) => update('weatherAlgoBucketHysteresisPolls', value)}
            />
            <NumberField
              label="Throttle re-entry (ms)"
              value={c().weatherAlgoReentryThrottleMs}
              min={0}
              max={86_400_000}
              step={60_000}
              hint="Pause après une sortie drift/bucket avant de pouvoir ré-entrer sur la même ville."
              onChange={(value) => update('weatherAlgoReentryThrottleMs', value)}
            />

            <h3 class="settings-subheading">Entrée & sélection</h3>
            <label>
              Edge minimum ({(c().weatherAlgoMinEdge * 100).toFixed(0)}%)
              <input
                type="range"
                min="0.05"
                max="0.30"
                step="0.01"
                value={c().weatherAlgoMinEdge}
                onInput={(e) => update('weatherAlgoMinEdge', Number(e.currentTarget.value))}
              />
            </label>
            <NullableNumberField
              label="Std dev max (°C, vide = illimité)"
              value={c().weatherAlgoMaxForecastStd}
              min={0}
              max={20}
              step={0.5}
              onChange={(value) => update('weatherAlgoMaxForecastStd', value)}
            />
            <NumberField
              label="USDC par entrée"
              value={c().weatherAlgoEntryUsdc}
              min={1}
              max={10_000}
              step={1}
              onChange={(value) => update('weatherAlgoEntryUsdc', value)}
            />
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
            <NumberField
              label="Retries profondeur ask (entrée)"
              value={c().weatherAlgoEntryDepthRetryMax}
              min={0}
              step={1}
              onChange={(value) => update('weatherAlgoEntryDepthRetryMax', value)}
            />
            <NumberField
              label="Délai entre retries profondeur (ms)"
              value={c().weatherAlgoEntryDepthRetryDelayMs}
              min={0}
              step={100}
              onChange={(value) => update('weatherAlgoEntryDepthRetryDelayMs', value)}
            />

            <h3 class="settings-subheading">Gestion de position</h3>
            <div class="form-field">
              <label>Si la prévision change de palier</label>
              <select
                class="select"
                value={c().weatherAlgoCityFollowSwitchMode}
                onChange={(e) => update('weatherAlgoCityFollowSwitchMode', e.currentTarget.value)}
              >
                <option value="close_and_reenter">Fermer et re-entrer sur le nouveau palier</option>
                <option value="hold">Conserver la position (drift / fenêtre résolution uniquement)</option>
              </select>
            </div>
            <NumberField
              label="Seuil drift forecast (°C)"
              value={c().weatherAlgoForecastChangeThreshold}
              min={0.5}
              max={20}
              step={0.5}
              hint="Ferme la position si le forecast mean dérive au-delà de ce seuil."
              onChange={(value) => update('weatherAlgoForecastChangeThreshold', value)}
            />
            <NumberField
              label="Pré-clôture (heures avant fin)"
              value={c().weatherAlgoCloseBeforeResolutionHours}
              min={0.5}
              max={168}
              step={0.5}
              hint="Dans cette fenêtre : bloque les nouvelles entrées et vend les positions ouvertes (motif WEATHER_PRE_CLOSE)."
              onChange={(value) => update('weatherAlgoCloseBeforeResolutionHours', value)}
            />

            <h3 class="settings-subheading">SL / TP / Trailing</h3>
            <ToggleField
              label="Stop Loss"
              checked={c().weatherAlgoSlEnabled}
              onChange={(checked) => update('weatherAlgoSlEnabled', checked)}
            />
            <Show when={c().weatherAlgoSlEnabled}>
              <NullableNumberField
                label="Stop Loss (points bid)"
                value={c().weatherAlgoSlBidPoints}
                min={0}
                max={1}
                step={0.01}
                placeholder="auto"
                onChange={(value) => update('weatherAlgoSlBidPoints', value)}
              />
            </Show>
            <ToggleField
              label="Take Profit"
              checked={c().weatherAlgoTpEnabled}
              onChange={(checked) => update('weatherAlgoTpEnabled', checked)}
            />
            <Show when={c().weatherAlgoTpEnabled}>
              <NullableNumberField
                label="Take Profit (points bid)"
                value={c().weatherAlgoTpBidPoints}
                min={0}
                max={1}
                step={0.01}
                placeholder="auto"
                onChange={(value) => update('weatherAlgoTpBidPoints', value)}
              />
            </Show>
            <ToggleField
              label="Trailing stop"
              checked={c().weatherAlgoTrailingEnabled}
              onChange={(checked) => update('weatherAlgoTrailingEnabled', checked)}
            />
            <Show when={c().weatherAlgoTrailingEnabled}>
              <NullableNumberField
                label="Trailing stop (points bid)"
                value={c().weatherAlgoTrailingBidPoints}
                min={0}
                max={1}
                step={0.01}
                placeholder="auto"
                onChange={(value) => update('weatherAlgoTrailingBidPoints', value)}
              />
              <NullableNumberField
                label="Activation trailing (points bid)"
                value={c().weatherAlgoTrailingActivationBidPoints}
                min={0}
                max={1}
                step={0.01}
                placeholder="auto"
                onChange={(value) => update('weatherAlgoTrailingActivationBidPoints', value)}
              />
            </Show>
            <NumberField
              label="Ticks de confirmation SL"
              value={c().weatherAlgoSlConfirmationTicks}
              min={1}
              max={10}
              step={1}
              onChange={(value) => update('weatherAlgoSlConfirmationTicks', value)}
            />
            <NumberField
              label="Retries max close SL"
              value={c().weatherAlgoSlCloseMaxRetries}
              min={0}
              step={1}
              onChange={(value) => update('weatherAlgoSlCloseMaxRetries', value)}
            />

            <h3 class="settings-subheading">Limites & capital</h3>
            <NumberField
              label="Max positions ouvertes"
              value={c().weatherAlgoMaxOpenPositions}
              min={1}
              step={1}
              onChange={(value) => update('weatherAlgoMaxOpenPositions', value)}
            />
            <NumberField
              label="Max exposition (USDC)"
              value={c().weatherAlgoMaxExposureUsdc}
              min={0}
              step={1}
              onChange={(value) => update('weatherAlgoMaxExposureUsdc', value)}
            />
            <NumberField
              label="Max perte journalière (USDC)"
              value={c().weatherAlgoMaxDailyLossUsdc}
              min={0}
              step={1}
              onChange={(value) => update('weatherAlgoMaxDailyLossUsdc', value)}
            />
            <NumberField
              label="Plafond max par position (USDC)"
              value={c().weatherAlgoMaxPositionSizeUsdc}
              min={0}
              step={1}
              onChange={(value) => update('weatherAlgoMaxPositionSizeUsdc', value)}
            />
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
