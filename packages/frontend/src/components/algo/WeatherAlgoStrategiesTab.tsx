import { createEffect, createSignal, For, Show, onMount } from 'solid-js';
import {
  fetchWeatherConfig,
  fetchWeatherStrategyCatalog,
  updateWeatherConfig,
  type WeatherConfig,
  type WeatherStrategyMeta,
} from '../../api';
import { CollapsibleSection } from '../CollapsibleSection';
import { StrategyParamsEditor } from '../settings/StrategyParamsEditor';

type Env = 'sim' | 'real';

const ENV_LABEL: Record<Env, string> = {
  sim: 'Simulation (sim)',
  real: 'Réel (real)',
};

interface EnvSectionProps {
  env: Env;
  config: WeatherConfig;
  catalog: WeatherStrategyMeta[];
  onSelectStrategy: (env: Env, id: string) => void;
  onUpdateStrategyParam: (env: Env, strategyId: string, key: string, value: number | boolean | string | null) => void;
}

function EnvSection(props: EnvSectionProps) {
  const { env } = props;
  const strategiesKey = env === 'sim' ? 'simWeatherAlgoStrategies' : 'realWeatherAlgoStrategies';
  const paramsKey = env === 'sim' ? 'simWeatherAlgoStrategyParams' : 'realWeatherAlgoStrategyParams';
  const strategies = () => props.config[strategiesKey] ?? [];
  const params = () => props.config[paramsKey] ?? {};
  const activeId = () => strategies()[0];
  const activeStrategy = () => props.catalog.find((s) => s.id === activeId());

  return (
    <section class="weather-strategies__env">
      <h3 class="settings-subheading">Stratégie active — {ENV_LABEL[env]}</h3>
      <div class="weather-strategy-cards">
        <For each={props.catalog}>
          {(strategy) => (
            <label
              class="weather-strategy-card"
              classList={{ 'weather-strategy-card--active': strategy.id === activeId() }}
              onClick={() => props.onSelectStrategy(env, strategy.id)}
            >
              <input
                type="radio"
                name={`weather-active-strategy-${env}`}
                checked={strategy.id === activeId()}
                onChange={() => props.onSelectStrategy(env, strategy.id)}
              />
              <span class="weather-strategy-card__radio" aria-hidden="true" />
              <span class="weather-strategy-card__body">
                <span class="weather-strategy-card__name">{strategy.label}</span>
                <span class="weather-strategy-card__desc">{strategy.description}</span>
              </span>
              <span class="weather-strategy-card__badge">
                {strategy.id === activeId() ? 'Active' : 'Inactive'}
              </span>
            </label>
          )}
        </For>
      </div>

      <Show when={activeStrategy() && activeStrategy()!.params.length > 0}>
        <div class="weather-strategies__params">
          <div class="weather-strategies__params-head">
            <h3 class="settings-subheading">Configuration — {activeStrategy()!.label}</h3>
            <span class="weather-strategies__params-count">
              {activeStrategy()!.params.length} paramètres
            </span>
          </div>
          <StrategyParamsEditor
            strategy={activeStrategy()!}
            values={params()[activeStrategy()!.id] ?? {}}
            overrides={{}}
            onChange={(key, value) =>
              props.onUpdateStrategyParam(env, activeStrategy()!.id, key, value)
            }
          />
        </div>
      </Show>
    </section>
  );
}

export interface WeatherAlgoStrategiesTabProps {
  weatherConfig?: WeatherConfig | null;
  catalog?: WeatherStrategyMeta[];
  onConfigSaved?: (cfg: WeatherConfig) => void;
}

export function WeatherAlgoStrategiesTab(props: WeatherAlgoStrategiesTabProps = {}) {
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

  // Source de vérité partagée avec CapitalHero (dashboard). Un PUT depuis le
  // sélecteur du hero doit mettre à jour les radios de cet onglet, sinon un
  // Sauvegarder ultérieur réécrirait l'ancienne liste de stratégies.
  createEffect(() => {
    const incoming = props.weatherConfig;
    if (!incoming) return;
    setConfig((prev) => {
      if (!prev) return incoming;
      // CapitalHero ne change que la stratégie active : on synchronise les
      // listes sans écraser des params encore non sauvegardés dans cet onglet.
      return {
        ...prev,
        simWeatherAlgoStrategies: incoming.simWeatherAlgoStrategies,
        realWeatherAlgoStrategies: incoming.realWeatherAlgoStrategies,
      };
    });
    setLoaded(true);
  });

  createEffect(() => {
    const incomingCatalog = props.catalog;
    if (incomingCatalog && incomingCatalog.length > 0) {
      setCatalog(incomingCatalog);
    }
  });

  onMount(() => {
    if (!props.weatherConfig) void load();
  });

  function update<K extends keyof WeatherConfig>(key: K, value: WeatherConfig[K]) {
    setConfig((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  function selectStrategy(env: Env, id: string) {
    const c = config();
    if (!c) return;
    const key = env === 'sim' ? 'simWeatherAlgoStrategies' : 'realWeatherAlgoStrategies';
    const current = c[key] ?? [];
    // On garde toujours au moins une stratégie active.
    if (current.length === 1 && current[0] === id) return;
    update(key, [id]);
  }

  function updateStrategyParam(
    env: Env,
    strategyId: string,
    key: string,
    value: number | boolean | string | null,
  ) {
    const c = config();
    if (!c) return;
    const paramsKey = env === 'sim' ? 'simWeatherAlgoStrategyParams' : 'realWeatherAlgoStrategyParams';
    const all = { ...(c[paramsKey] ?? {}) };
    all[strategyId] = { ...(all[strategyId] ?? {}), [key]: value };
    update(paramsKey, all);
  }

  async function saveConfig() {
    const c = config();
    if (!c) return;
    setSaving(true);
    setError(null);
    try {
      // Envoie les 4 champs per-env (jamais les legacy weatherAlgoStrategies /
      // weatherAlgoStrategyParams — figés après migration).
      const updated = await updateWeatherConfig({
        simWeatherAlgoStrategies: c.simWeatherAlgoStrategies,
        realWeatherAlgoStrategies: c.realWeatherAlgoStrategies,
        simWeatherAlgoStrategyParams: c.simWeatherAlgoStrategyParams,
        realWeatherAlgoStrategyParams: c.realWeatherAlgoStrategyParams,
      });
      const { sessionRotation: _sessionRotation, ...cfg } = updated as WeatherConfig & {
        sessionRotation?: unknown;
      };
      setConfig(cfg);
      props.onConfigSaved?.(cfg);
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
          {(c) => (
            <div class="weather-strategies">
              <div class="weather-strategies__intro">
                <p class="form-hint">
                  Une seule stratégie peut être active par environnement (sim / réel). Chaque
                  environnement dispose de sa propre liste de stratégies et de ses propres
                  paramètres.
                </p>
              </div>
              <EnvSection
                env="sim"
                config={c()}
                catalog={catalog()}
                onSelectStrategy={selectStrategy}
                onUpdateStrategyParam={updateStrategyParam}
              />
              <EnvSection
                env="real"
                config={c()}
                catalog={catalog()}
                onSelectStrategy={selectStrategy}
                onUpdateStrategyParam={updateStrategyParam}
              />
            </div>
          )}
        </Show>
      </Show>
    </CollapsibleSection>
  );
}
