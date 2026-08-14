import { createSignal, For, Show, onMount } from 'solid-js';
import {
  fetchWeatherConfig,
  fetchWeatherStrategyCatalog,
  updateWeatherConfig,
  type WeatherConfig,
  type WeatherStrategyMeta,
} from '../api';
import { CollapsibleSection } from './CollapsibleSection';
import { NumberField, ToggleField, SelectField, NullableNumberField } from './settings-fields';

/** Nullable numeric knobs: stored `0` is coerced to `null` at runtime, so the
 * form uses NullableNumberField to write `null` (disabled) instead of `0`. */
const NULLABLE_PARAM_KEYS = new Set([
  'maxForecastStd',
  'minForecastProbability',
  'slBidPoints',
  'tpBidPoints',
  'trailingBidPoints',
  'trailingActivationBidPoints',
]);

/** Regroupement logique des paramètres pour un affichage professionnel. */
const PARAM_GROUPS: Array<{ id: string; title: string; keys: string[] }> = [
  {
    id: 'entry',
    title: 'Entrée',
    keys: ['minEdge', 'maxForecastStd', 'minForecastProbability', 'minYesPrice', 'entryUsdc', 'sizingMode'],
  },
  {
    id: 'exit',
    title: 'Sortie',
    keys: [
      'forecastChangeThreshold',
      'closeBeforeResolutionHours',
      'bucketHysteresisPolls',
      'reentryThrottleMs',
      'cityFollowSwitchMode',
    ],
  },
  {
    id: 'sl-tp',
    title: 'Stop-loss / Take-profit',
    keys: [
      'slEnabled',
      'tpEnabled',
      'trailingEnabled',
      'slBidPoints',
      'tpBidPoints',
      'trailingBidPoints',
      'trailingActivationBidPoints',
    ],
  },
  {
    id: 'risk',
    title: 'Limites de risque',
    keys: ['maxOpenPositions', 'maxExposureUsdc', 'maxDailyLossUsdc', 'maxPositionSizeUsdc'],
  },
  {
    id: 'execution',
    title: 'Exécution',
    keys: [
      'entryDepthRetryMax',
      'entryDepthRetryDelayMs',
      'slCloseMaxRetries',
      'slConfirmationTicks',
      'killSwitchAction',
    ],
  },
  {
    id: 'preclose',
    title: 'Pré-clôture',
    keys: ['preCloseEnabled', 'preCloseSeconds'],
  },
  {
    id: 'misc',
    title: 'Divers',
    keys: ['signalScoreSizingEnabled', 'minBidToAskRatio', 'minTimeToClose'],
  },
];

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

  onMount(() => void load());

  function update<K extends keyof WeatherConfig>(key: K, value: WeatherConfig[K]) {
    setConfig((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  function selectStrategy(id: string) {
    const c = config();
    if (!c) return;
    const current = c.weatherAlgoStrategies ?? [];
    // On garde toujours au moins une stratégie active.
    if (current.length === 1 && current[0] === id) return;
    update('weatherAlgoStrategies', [id]);
  }

  function updateStrategyParam(
    strategyId: string,
    key: string,
    value: number | boolean | string | null,
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
      <Show when={error()}>
        <p class="form-hint weather-settings-error">{error()}</p>
      </Show>
      <Show when={loaded()} fallback={<div class="algo-empty">Chargement…</div>}>
        <Show when={config()}>
          {(c) => {
            const activeId = () => (c().weatherAlgoStrategies ?? [])[0];
            const activeStrategy = () => catalog().find((s) => s.id === activeId());
            return (
              <div class="weather-strategies">
                <div class="weather-strategies__intro">
                  <p class="form-hint">
                    Une seule stratégie peut être active à la fois. Chaque stratégie dispose de sa
                    propre configuration ci-dessous.
                  </p>
                </div>

                <section class="weather-strategies__selector">
                  <h3 class="settings-subheading">Stratégie active</h3>
                  <div class="weather-strategy-cards">
                    <For each={catalog()}>
                      {(strategy) => (
                        <label
                          class="weather-strategy-card"
                          classList={{
                            'weather-strategy-card--active': strategy.id === activeId(),
                          }}
                          onClick={() => selectStrategy(strategy.id)}
                        >
                          <input
                            type="radio"
                            name="weather-active-strategy"
                            checked={strategy.id === activeId()}
                            onChange={() => selectStrategy(strategy.id)}
                          />
                          <span class="weather-strategy-card__radio" aria-hidden="true" />
                          <span class="weather-strategy-card__body">
                            <span class="weather-strategy-card__name">{strategy.label}</span>
                            <span class="weather-strategy-card__desc">
                              {strategy.description}
                            </span>
                          </span>
                          <span class="weather-strategy-card__badge">
                            {strategy.id === activeId() ? 'Active' : 'Inactive'}
                          </span>
                        </label>
                      )}
                    </For>
                  </div>
                </section>

                <Show when={activeStrategy() && activeStrategy()!.params.length > 0}>
                  <section class="weather-strategies__params">
                    <div class="weather-strategies__params-head">
                      <h3 class="settings-subheading">
                        Configuration — {activeStrategy()!.label}
                      </h3>
                      <span class="weather-strategies__params-count">
                        {activeStrategy()!.params.length} paramètres
                      </span>
                    </div>
                    <div class="weather-strategy-groups">
                      <For each={PARAM_GROUPS}>
                        {(group) => {
                          const params = activeStrategy()!.params.filter((p) =>
                            group.keys.includes(p.key),
                          );
                          return (
                            <Show when={params.length > 0}>
                              <div class="weather-strategy-group">
                                <h4 class="weather-strategy-group__title">{group.title}</h4>
                                <div class="weather-strategy-group__fields">
                                  <For each={params}>
                                    {(param) => (
                                      <Show
                                        when={param.kind === 'boolean'}
                                        fallback={
                                          <Show
                                            when={param.kind === 'select'}
                                            fallback={
                                              <Show
                                                when={NULLABLE_PARAM_KEYS.has(param.key)}
                                                fallback={
                                                  <NumberField
                                                    label={param.label}
                                                    value={Number(
                                                      (c().weatherAlgoStrategyParams?.[
                                                        activeStrategy()!.id
                                                      ] ?? {})[param.key] ?? param.default,
                                                    )}
                                                    min={param.min}
                                                    max={param.max}
                                                    step={param.step ?? 0.01}
                                                    hint={param.hint}
                                                    onChange={(value) =>
                                                      updateStrategyParam(
                                                        activeStrategy()!.id,
                                                        param.key,
                                                        value,
                                                      )
                                                    }
                                                  />
                                                }
                                              >
                                                <NullableNumberField
                                                  label={param.label}
                                                  value={
                                                    (c().weatherAlgoStrategyParams?.[
                                                      activeStrategy()!.id
                                                    ] ?? {})[param.key] as
                                                      | number
                                                      | null
                                                      | undefined ?? null
                                                  }
                                                  min={param.min}
                                                  max={param.max}
                                                  step={param.step ?? 0.01}
                                                  hint={param.hint}
                                                  onChange={(value) =>
                                                    updateStrategyParam(
                                                      activeStrategy()!.id,
                                                      param.key,
                                                      value,
                                                    )
                                                  }
                                                />
                                              </Show>
                                            }
                                          >
                                            <SelectField
                                              label={param.label}
                                              value={String(
                                                (c().weatherAlgoStrategyParams?.[
                                                  activeStrategy()!.id
                                                ] ?? {})[param.key] ?? param.default,
                                              )}
                                              options={param.options ?? []}
                                              hint={param.hint}
                                              onChange={(value) =>
                                                updateStrategyParam(
                                                  activeStrategy()!.id,
                                                  param.key,
                                                  value,
                                                )
                                              }
                                            />
                                          </Show>
                                        }
                                      >
                                        <ToggleField
                                          label={param.label}
                                          checked={Boolean(
                                            (c().weatherAlgoStrategyParams?.[
                                              activeStrategy()!.id
                                            ] ?? {})[param.key] ?? param.default,
                                          )}
                                          hint={param.hint}
                                          onChange={(checked) =>
                                            updateStrategyParam(
                                              activeStrategy()!.id,
                                              param.key,
                                              checked,
                                            )
                                          }
                                        />
                                      </Show>
                                    )}
                                  </For>
                                </div>
                              </div>
                            </Show>
                          );
                        }}
                      </For>
                    </div>
                  </section>
                </Show>
              </div>
            );
          }}
        </Show>
      </Show>
    </CollapsibleSection>
  );
}
