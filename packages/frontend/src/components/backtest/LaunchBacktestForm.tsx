import { For, Show } from 'solid-js';
import type { Accessor, Setter } from 'solid-js';
import type {
  BacktestDataCoverage,
  WeatherStrategyMeta,
} from '../../api';
import { formatTs } from './format';

/** Stratégies affichées quand le catalogue n'est pas encore chargé (R3). */
const FALLBACK_STRATEGIES = [
  { id: 'weather-forecast', label: 'Forecast (best edge)' },
  { id: 'weather-forecast-aligned', label: 'Forecast (aligned)' },
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
  entryUsdc: Accessor<string>;
  setEntryUsdc: Setter<string>;
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
  selectionMode: Accessor<string>;
  setSelectionMode: Setter<string>;
  launching: Accessor<boolean>;
  launchError: Accessor<string | null>;
  onFidelityChange: () => void;
  onSubmit: (e: Event) => void;
}

export function LaunchBacktestForm(props: LaunchBacktestFormProps) {
  const coverage = () => props.coverage();
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

      <div class="backtest-form-grid">
        <label class="backtest-field">
          <span>Du</span>
          <input type="date" value={props.from()} onInput={(e) => props.setFrom(e.currentTarget.value)} />
        </label>
        <label class="backtest-field">
          <span>Au</span>
          <input type="date" value={props.to()} onInput={(e) => props.setTo(e.currentTarget.value)} />
        </label>
        <span class="form-hint" title="Les bornes sont interprétées en UTC (le backend applique new Date(params.from)).">
          Les dates sont interprétées en <strong>UTC</strong> — un décalage peut apparaître selon votre fuseau local.
        </span>
        <label class="backtest-field">
          <span>Villes (séparées par virgule, optionnel)</span>
          <input
            type="text"
            value={props.cities()}
            onInput={(e) => props.setCities(e.currentTarget.value)}
            placeholder="ex. london, paris"
            title="Vide = toutes les villes. Séparées par virgule pour restreindre."
          />
        </label>
        <label class="backtest-field">
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
        <label class="backtest-field">
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
        <label class="backtest-field">
          <span>Capital initial (USDC)</span>
          <input type="number" min="1" value={props.capital()} onInput={(e) => props.setCapital(e.currentTarget.value)} />
        </label>
        <label class="backtest-field">
          <span>Entry / position (USDC)</span>
          <input type="number" min="0" value={props.entryUsdc()} onInput={(e) => props.setEntryUsdc(e.currentTarget.value)} />
        </label>
        <label class="backtest-field">
          <span>Slippage (bps)</span>
          <input type="number" min="0" value={props.slippageBps()} onInput={(e) => props.setSlippageBps(e.currentTarget.value)} />
        </label>
        <label class="backtest-field">
          <span>Max positions concurrentes</span>
          <input type="number" min="1" value={props.maxPos()} onInput={(e) => props.setMaxPos(e.currentTarget.value)} />
        </label>
        <label class="backtest-field">
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
        <label class="backtest-field backtest-field-wide">
          <span>Libellé (optionnel)</span>
          <input type="text" value={props.label()} onInput={(e) => props.setLabel(e.currentTarget.value)} />
        </label>
      </div>
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