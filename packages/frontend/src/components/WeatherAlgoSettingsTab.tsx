import { createSignal, Show } from 'solid-js';
import { fetchWeatherConfig, updateWeatherConfig } from '../api';

export function WeatherAlgoSettingsTab() {
  const [config, setConfig] = createSignal<Record<string, unknown> | null>(null);
  const [saving, setSaving] = createSignal(false);
  const [loaded, setLoaded] = createSignal(false);

  async function loadConfig() {
    try {
      setConfig(await fetchWeatherConfig() as unknown as Record<string, unknown>);
    } catch { /* ignore */ }
    setLoaded(true);
  }

  async function saveConfig() {
    const c = config();
    if (!c) return;
    setSaving(true);
    try {
      await updateWeatherConfig({
        weatherAlgoEnabled: c.weatherAlgoEnabled as boolean,
        weatherAlgoSimEnabled: c.weatherAlgoSimEnabled as boolean,
        weatherAlgoRealEnabled: c.weatherAlgoRealEnabled as boolean,
        weatherAlgoMinEdge: c.weatherAlgoMinEdge as number,
        weatherAlgoMaxForecastStd: c.weatherAlgoMaxForecastStd as number | null,
        weatherAlgoSizingMode: c.weatherAlgoSizingMode as string,
        weatherAlgoEntryUsdc: c.weatherAlgoEntryUsdc as number,
        weatherAlgoSelectionMode: c.weatherAlgoSelectionMode as string,
        weatherAlgoMaxSignalsPerEvent: c.weatherAlgoMaxSignalsPerEvent as number,
        weatherAlgoForecastChangeThreshold: c.weatherAlgoForecastChangeThreshold as number,
        weatherAlgoCloseBeforeResolutionHours: c.weatherAlgoCloseBeforeResolutionHours as number,
        weatherAlgoPollMs: c.weatherAlgoPollMs as number,
        weatherAlgoCityFollowSwitchMode: c.weatherAlgoCityFollowSwitchMode as string,
        weatherAlgoBucketHysteresisPolls: c.weatherAlgoBucketHysteresisPolls as number,
        weatherAlgoReentryThrottleMs: c.weatherAlgoReentryThrottleMs as number,
      });
    } catch { /* ignore */ }
    setSaving(false);
  }

  if (!loaded()) void loadConfig();

  function update<K extends string>(key: K, value: unknown) {
    setConfig((prev) => prev ? { ...prev, [key]: value } : prev);
  }

  return (
    <section class="algo-panel">
      <div class="algo-panel-header">
        <h2 class="algo-panel-title">Paramètres Weather Algo</h2>
        <button class="btn btn-sm btn-primary" onClick={() => saveConfig()} disabled={saving()}>
          {saving() ? '...' : 'Sauvegarder'}
        </button>
      </div>
      <Show when={config()}>
        {(c) => (
          <div class="weather-settings-grid">
            <label>
              <input type="checkbox" checked={c().weatherAlgoEnabled as boolean}
                onInput={(e) => update('weatherAlgoEnabled', e.currentTarget.checked)} />
              Algo activé
            </label>
            <label>
              <input type="checkbox" checked={c().weatherAlgoSimEnabled as boolean}
                onInput={(e) => update('weatherAlgoSimEnabled', e.currentTarget.checked)} />
              Mode Simulation actif
            </label>
            <label>
              <input type="checkbox" checked={c().weatherAlgoRealEnabled as boolean}
                onInput={(e) => update('weatherAlgoRealEnabled', e.currentTarget.checked)} />
              Mode Réel actif
              <span class="form-hint">Requiert aussi le master kill global <code>realTradingEnabled</code> activé.</span>
            </label>
            <label>
              Edge minimum ({((c().weatherAlgoMinEdge as number) * 100).toFixed(0)}%)
              <input type="range" min="0.05" max="0.30" step="0.01"
                value={c().weatherAlgoMinEdge as number}
                onInput={(e) => update('weatherAlgoMinEdge', Number(e.currentTarget.value))} />
            </label>
            <label>
              Std dev max (°C, vide = illimité)
              <input type="number" step="0.5"
                value={c().weatherAlgoMaxForecastStd ?? ''}
                onInput={(e) => update('weatherAlgoMaxForecastStd',
                  e.currentTarget.value ? Number(e.currentTarget.value) : null)} />
            </label>
            <label>
              USDC par entrée
              <input type="number" step="1" value={c().weatherAlgoEntryUsdc as number}
                onInput={(e) => update('weatherAlgoEntryUsdc', Number(e.currentTarget.value))} />
            </label>
            <label>
              Mode de sélection (entre villes)
              <select value={c().weatherAlgoSelectionMode as string}
                onChange={(e) => update('weatherAlgoSelectionMode', e.currentTarget.value)}>
                <option value="single">Single (meilleure ville)</option>
                <option value="multi">Multi (top N villes)</option>
              </select>
              <span class="form-hint">Spread n’est plus disponible en mode ville.</span>
            </label>
            <label>
              Max villes (mode multi)
              <input type="number" min="1" max="20"
                value={c().weatherAlgoMaxSignalsPerEvent as number}
                onInput={(e) => update('weatherAlgoMaxSignalsPerEvent', Number(e.currentTarget.value))} />
            </label>
            <label>
              Seuil drift forecast (°C)
              <input type="number" step="0.5"
                value={c().weatherAlgoForecastChangeThreshold as number}
                onInput={(e) => update('weatherAlgoForecastChangeThreshold', Number(e.currentTarget.value))} />
              <span class="form-hint">Ferme la position si le forecast mean dérive au-delà de ce seuil.</span>
            </label>
            <label>
              Fenêtre avant résolution (heures)
              <input type="number" step="0.5"
                value={c().weatherAlgoCloseBeforeResolutionHours as number}
                onInput={(e) => update('weatherAlgoCloseBeforeResolutionHours', Number(e.currentTarget.value))} />
              <span class="form-hint">Bloque les nouvelles entrées et ferme les positions ouvertes dans cette fenêtre.</span>
            </label>
            <label>
              Si la prévision change de palier
              <select value={c().weatherAlgoCityFollowSwitchMode as string}
                onChange={(e) => update('weatherAlgoCityFollowSwitchMode', e.currentTarget.value)}>
                <option value="close_and_reenter">Fermer et re-entrer sur le nouveau palier</option>
                <option value="hold">Conserver la position (drift / pre-close uniquement)</option>
              </select>
            </label>
            <label>
              Hysteresis bucket (polls hors palier)
              <input type="number" min="1" max="10"
                value={(c().weatherAlgoBucketHysteresisPolls as number) ?? 2}
                onInput={(e) => update('weatherAlgoBucketHysteresisPolls', Number(e.currentTarget.value))} />
              <span class="form-hint">Nombre de polls consécutifs hors palier avant fermeture (close_and_reenter).</span>
            </label>
            <label>
              Throttle re-entry (ms)
              <input type="number" min="0" step="60000"
                value={(c().weatherAlgoReentryThrottleMs as number) ?? 1800000}
                onInput={(e) => update('weatherAlgoReentryThrottleMs', Number(e.currentTarget.value))} />
              <span class="form-hint">Pause après une sortie drift/bucket avant de pouvoir ré-entrer sur la même ville.</span>
            </label>
          </div>
        )}
      </Show>
    </section>
  );
}
