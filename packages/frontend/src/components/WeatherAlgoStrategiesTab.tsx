import { createSignal, For, Show } from 'solid-js';
import {
  fetchWeatherConfig,
  fetchWeatherStrategyCatalog,
  updateWeatherConfig,
  type WeatherConfig,
  type WeatherStrategyMeta,
} from '../api';
import { CollapsibleSection } from './CollapsibleSection';
import { NumberField, ToggleField } from './settings-fields';

export function WeatherAlgoStrategiesTab() {
  const [config, setConfig] = createSignal<WeatherConfig | null>(null);
  const [catalog, setCatalog] = createSignal<WeatherStrategyMeta[]>([]);
  const [saving, setSaving] = createSignal(false);
  const [loaded, setLoaded] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  async function load() {
    try {
      const [cfg, cat] = await Promise.all([
        fetchWeatherConfig(),
        fetchWeatherStrategyCatalog(),
      ]);
      setConfig(cfg);
      setCatalog(cat.strategies);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Chargement impossible');
    }
    setLoaded(true);
  }

  if (!loaded()) void load();

  function update<K extends keyof WeatherConfig>(key: K, value: WeatherConfig[K]) {
    setConfig((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  function toggleStrategy(id: string, checked: boolean) {
    const c = config();
    if (!c) return;
    const current = c.weatherAlgoStrategies ?? [];
    const next = checked ? [...current, id] : current.filter((s) => s !== id);
    if (next.length === 0) return;
    update('weatherAlgoStrategies', next);
  }

  function updateStrategyParam(
    strategyId: string,
    key: string,
    value: number | boolean | string,
  ) {
    const c = config();
    if (!c) return;
    const all = { ...(c.weatherAlgoStrategyParams ?? {}) };
    all[strategyId] = { ...(all[strategyId] ?? {}), [key]: value };
    update('weatherAlgoStrategyParams', all);
  }

  async function saveConfig() {
    const c = config();
    if (!c) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await updateWeatherConfig({
        weatherAlgoStrategies: c.weatherAlgoStrategies,
        weatherAlgoStrategyParams: c.weatherAlgoStrategyParams,
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

  return (
    <CollapsibleSection
      title="Stratégies Weather Algo"
      persistKey="polywatch_weather_strategies_collapsed"
      headerActions={
        <button class="btn btn-sm btn-primary" onClick={() => saveConfig()} disabled={saving()}>
          {saving() ? '...' : 'Sauvegarder'}
        </button>
      }
    >
      <p class="form-hint">
        Ordre du catalogue = priorité first-wins si plusieurs stratégies sont cochées. Les
        paramètres globaux (minEdge, minForecastProb…) restent dans l&apos;onglet Paramètres.
      </p>
      <Show when={error()}>
        <p class="form-hint weather-settings-error">{error()}</p>
      </Show>
      <Show when={config()}>
        {(c) => (
          <div class="weather-settings-grid">
            <h3 class="settings-subheading">Stratégies activées</h3>
            <div class="settings-checkbox-group">
              <For each={catalog()}>
                {(strategy) => (
                  <label class="checkbox-tag">
                    <input
                      type="checkbox"
                      checked={(c().weatherAlgoStrategies ?? []).includes(strategy.id)}
                      onChange={(e) =>
                        toggleStrategy(strategy.id, e.currentTarget.checked)
                      }
                    />
                    <span>{strategy.label}</span>
                    <span class="checkbox-tag-hint">{strategy.description}</span>
                  </label>
                )}
              </For>
            </div>

            <For
              each={catalog().filter(
                (s) =>
                  (c().weatherAlgoStrategies ?? []).includes(s.id) && s.params.length > 0,
              )}
            >
              {(strategy) => (
                <div class="weather-strategy-params-block">
                  <h3 class="settings-subheading">{strategy.label}</h3>
                  <For each={strategy.params}>
                    {(param) => (
                      <Show
                        when={param.kind === 'boolean'}
                        fallback={
                          <NumberField
                            label={param.label}
                            value={Number(
                              (c().weatherAlgoStrategyParams?.[strategy.id] ?? {})[param.key] ??
                                param.default,
                            )}
                            min={param.min}
                            max={param.max}
                            step={param.step ?? 0.01}
                            hint={param.hint}
                            onChange={(value) =>
                              updateStrategyParam(strategy.id, param.key, value)
                            }
                          />
                        }
                      >
                        <ToggleField
                          label={param.label}
                          checked={Boolean(
                            (c().weatherAlgoStrategyParams?.[strategy.id] ?? {})[param.key] ??
                              param.default,
                          )}
                          hint={param.hint}
                          onChange={(checked) =>
                            updateStrategyParam(strategy.id, param.key, checked)
                          }
                        />
                      </Show>
                    )}
                  </For>
                </div>
              )}
            </For>
          </div>
        )}
      </Show>
    </CollapsibleSection>
  );
}
