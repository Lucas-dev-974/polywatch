import { For, Show } from 'solid-js';
import type { Accessor, Setter } from 'solid-js';
import type {
  BacktestDataCoverage,
  WeatherStrategyMeta,
} from '../../api';
import { formatTs } from './format';
import { StrategyParamsEditor } from '../settings/StrategyParamsEditor';

/** Stratégies affichées quand le catalogue n'est pas encore chargé (R3). */
const FALLBACK_STRATEGIES = [
  { id: 'weather-forecast', label: 'Forecast (best edge)' },
  { id: 'weather-forecast-aligned', label: 'Forecast (aligned)' },
];

/**
 * Params du bag réellement consommés par le moteur de backtest (C1). Les
 * knobs d'exécution live (entryDepthRetry*, slCloseMaxRetries,
 * slConfirmationTicks, signalScoreSizingEnabled) et ceux écrasés par les champs
 * run-level (entryPusd, maxOpenPositions) sont exclus pour éviter des réglages
 * sans effet.
 */
const BACKTEST_EFFECTIVE_PARAM_KEYS = [
  // Entry gates
  'minEdge',
  'maxForecastStd',
  'minForecastProbability',
  'minYesPrice',
  'maxYesPrice',
  'allowedComparisons',
  // Sizing
  'sizingMode',
  'entryPusd',
  'fixedShareCount',
  'maxPositionSizePusd',
  // Exit
  'forecastChangeThreshold',
  'bucketHysteresisPolls',
  'reentryThrottleMs',
  'reentryThrottleAfterSlMs',
  'maxReentriesPerCityDate',
  'cityFollowSwitchMode',
  // SL / TP / trailing
  'slEnabled',
  'tpEnabled',
  'trailingEnabled',
  'slPercent',
  'tpPercent',
  'trailingPercent',
  'trailingActivationPercent',
  // Risk limits
  'maxExposurePusd',
  'maxDailyLossPusd',
  // Kill switch
  'killSwitchAction',
];

interface LaunchBacktestFormProps {
  coverage: Accessor<BacktestDataCoverage | null>;
  coverageLoading: Accessor<boolean>;
  catalog: Accessor<WeatherStrategyMeta[]>;
  from: Accessor<string>;
  setFrom: Setter<string>;
  to: Accessor<string>;
  setTo: Setter<string>;
  cities: Accessor<string>;
  setCities: Setter<string>;
  capital: Accessor<string>;
  setCapital: Setter<string>;
  entryPusd: Accessor<string>;
  setEntryPusd: Setter<string>;
  slippageBps: Accessor<string>;
  setSlippageBps: Setter<string>;
  maxPos: Accessor<string>;
  setMaxPos: Setter<string>;
  fidelityMinutes: Accessor<string>;
  setFidelityMinutes: Setter<string>;
  label: Accessor<string>;
  setLabel: Setter<string>;
  strategyId: Accessor<string>;
  setStrategyId: Setter<string>;
  strategyEnv: Accessor<'sim' | 'real'>;
  setStrategyEnv: Setter<'sim' | 'real'>;
  selectionMode: Accessor<string>;
  setSelectionMode: Setter<string>;
  /** Params live par stratégie (weatherAlgoStrategyParams de la config live). */
  liveStrategyParams: Accessor<Record<string, Record<string, number | boolean | string | null>>>;
  /** Overrides de params par stratégie pour la run en cours. */
  strategyConfigOverrides: Accessor<Record<string, Record<string, number | boolean | string | null>>>;
  setStrategyConfigOverrides: Setter<Record<string, Record<string, number | boolean | string | null>>>;
  launching: Accessor<boolean>;
  launchError: Accessor<string | null>;
  onFidelityChange: () => void;
  onSubmit: (e: Event) => void;
}

export function LaunchBacktestForm(props: LaunchBacktestFormProps) {
  const coverage = () => props.coverage();
  const selectedStrategy = () => props.catalog().find((s) => s.id === props.strategyId());

  return (
    <form class="backtest-form" onSubmit={props.onSubmit}>
      <h3 class="settings-subheading">Lancer un backtest</h3>
      <Show when={coverage()}>
        <div class="backtest-coverage">
          <span>
            Données dispo : <strong>{coverage()?.from ? formatTs(coverage()!.from) : '—'}</strong> →{' '}
            <strong>{coverage()?.to ? formatTs(coverage()!.to) : '—'}</strong>
          </span>
          <span>
            Ticks : <strong>{(coverage()?.totalTicks ?? 0).toLocaleString()}</strong>
          </span>
          <span>Villes : <strong>{coverage()?.cities.join(', ') || '—'}</strong></span>
        </div>
      </Show>
      <Show when={props.coverageLoading()}>
        <p class="form-hint">Chargement de la couverture de données…</p>
      </Show>

      <section class="backtest-strategy-config">
        <div class="backtest-strategy-config__head">
          <h3 class="settings-subheading">Config stratégie</h3>
          <span class="form-hint">
            Config uniquement pour ce backtest — n'affecte pas le live sim/réel.
          </span>
        </div>

        <div class="backtest-fields-2col">
          <label class="backtest-field-row">
            <span>Libellé (optionnel)</span>
            <input type="text" value={props.label()} onInput={(e) => props.setLabel(e.currentTarget.value)} />
          </label>
          <label class="backtest-field-row">
            <span>Villes (optionnel)</span>
            <input
              type="text"
              value={props.cities()}
              onInput={(e) => props.setCities(e.currentTarget.value)}
              placeholder="ex. london, paris"
              title="Vide = toutes les villes. Séparées par virgule pour restreindre."
            />
          </label>
          <label class="backtest-field-row">
            <span>Capital initial (pUSD)</span>
            <input type="number" min="1" value={props.capital()} onInput={(e) => props.setCapital(e.currentTarget.value)} />
          </label>
          <label class="backtest-field-row">
            <span>Du</span>
            <input type="date" value={props.from()} onInput={(e) => props.setFrom(e.currentTarget.value)} />
          </label>
          <label class="backtest-field-row">
            <span>Stratégie</span>
            <select
              value={props.strategyId()}
              onChange={(e) => props.setStrategyId(e.currentTarget.value)}
            >
              <option value="">
                Toutes (stratégies actives de la config)
              </option>
              <For each={props.catalog()}>
                {(s) => <option value={s.id}>{s.label}</option>}
              </For>
              <Show when={props.catalog().length === 0}>
                <For each={FALLBACK_STRATEGIES}>
                  {(s) => <option value={s.id}>{s.label}</option>}
                </For>
              </Show>
            </select>
          </label>
          <label class="backtest-field-row">
            <span>Au</span>
            <input type="date" value={props.to()} onInput={(e) => props.setTo(e.currentTarget.value)} />
          </label>
          <label class="backtest-field-row">
            <span>Environnement</span>
            <select
              value={props.strategyEnv()}
              onChange={(e) => props.setStrategyEnv(e.currentTarget.value === 'real' ? 'real' : 'sim')}
              title="Sélectionne la liste de stratégies + params de l'environnement (sim/réel) pour ce backtest. Ne réutilise pas le champ mode (toujours 'reevaluate')."
            >
              <option value="sim">Simulation (sim)</option>
              <option value="real">Réel (real)</option>
            </select>
          </label>
          <label class="backtest-field-row">
            <span>Mode de sélection</span>
            <select
              value={props.selectionMode()}
              onChange={(e) => props.setSelectionMode(e.currentTarget.value)}
              title="Surcharge le mode de sélection des signaux pour ce backtest. 'Config' = hérite de la config live (single/multi)."
            >
              <option value="">Config (défaut)</option>
              <option value="single">Single (1 signal par event)</option>
              <option value="multi">Multi (jusqu'à maxSignals par event)</option>
            </select>
          </label>
          <label class="backtest-field-row">
            <span>Max positions concurrentes</span>
            <input type="number" min="1" value={props.maxPos()} onInput={(e) => props.setMaxPos(e.currentTarget.value)} />
          </label>
          <label class="backtest-field-row">
            <span>Slippage (bps)</span>
            <input type="number" min="0" value={props.slippageBps()} onInput={(e) => props.setSlippageBps(e.currentTarget.value)} />
          </label>
          <label class="backtest-field-row">
            <span>Intervalle (min, optionnel)</span>
            <input
              type="number"
              min="1"
              placeholder="vide = tous"
              value={props.fidelityMinutes()}
              onInput={(e) => {
                props.setFidelityMinutes(e.currentTarget.value);
                props.onFidelityChange();
              }}
              title="Filtre les ticks par intervalle de fidelity (15 = 15 min). Vide = tous les intervalles."
            />
          </label>
        </div>

        <div class="backtest-utc-note">
          <span
            class="backtest-utc-hint"
            data-tooltip="Les bornes sont interprétées en UTC (le backend applique new Date(params.from)). Un décalage peut apparaître selon votre fuseau local."
            aria-label="Les dates sont interprétées en UTC — un décalage peut apparaître selon votre fuseau local."
            tabindex="0"
          >
            !
          </span>
          <span class="form-hint">Dates en UTC — un décalage peut apparaître selon votre fuseau local.</span>
        </div>

        <Show when={props.strategyId() && selectedStrategy()}>
          <StrategyParamsEditor
            strategy={selectedStrategy()!}
            values={props.liveStrategyParams()[selectedStrategy()!.id] ?? {}}
            overrides={props.strategyConfigOverrides()[selectedStrategy()!.id] ?? {}}
            visibleKeys={BACKTEST_EFFECTIVE_PARAM_KEYS}
            entryPusdField={{
              value: props.entryPusd(),
              onChange: props.setEntryPusd,
            }}
            onChange={(key, value) => {
              const sid = selectedStrategy()!.id;
              const current = props.strategyConfigOverrides()[sid] ?? {};
              props.setStrategyConfigOverrides((prev) => ({
                ...prev,
                [sid]: { ...current, [key]: value },
              }));
            }}
          />
        </Show>
        <Show when={!props.strategyId() || !selectedStrategy()}>
          <div class="backtest-fields-2col">
            <label class="backtest-field-row">
              <span>Entry / position (pUSD)</span>
              <input type="number" min="0" value={props.entryPusd()} onInput={(e) => props.setEntryPusd(e.currentTarget.value)} />
            </label>
          </div>
        </Show>
      </section>

      <Show when={props.launchError()}>
        <p class="form-hint weather-settings-error">{props.launchError()}</p>
      </Show>
      <div class="backtest-form-actions">
        <button type="submit" class="btn btn-sm btn-primary" disabled={props.launching()}>
          {props.launching() ? 'Lancement…' : 'Lancer le backtest'}
        </button>
      </div>
    </form>
  );
}