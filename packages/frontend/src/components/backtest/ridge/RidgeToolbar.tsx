import { For, Show } from 'solid-js';
import type { Signal } from 'solid-js';

/**
 * Toolbar du ridge plot : filtres (date cible, derniers ticks, coupure des
 * trous, entrée/sortie, ticks exclus, player) et bouton de réinitialisation
 * du pan/zoom.
 */
export function RidgeToolbar(props: {
  targetDates: string[];
  targetDateFilter: Signal<string>;
  maxTicks: Signal<number>;
  cutGaps: Signal<boolean>;
  minAvgYes: Signal<number>;
  showEntryExit: Signal<boolean>;
  showExcluded: Signal<boolean>;
  playerEnabled: Signal<boolean>;
  enablePlayer: boolean;
  onReset: () => void;
}) {
  const [targetDateFilter, setTargetDateFilter] = props.targetDateFilter;
  const [maxTicks, setMaxTicks] = props.maxTicks;
  const [cutGaps, setCutGaps] = props.cutGaps;
  const [minAvgYes, setMinAvgYes] = props.minAvgYes;
  const [showEntryExit, setShowEntryExit] = props.showEntryExit;
  const [showExcluded, setShowExcluded] = props.showExcluded;
  const [playerEnabled, setPlayerEnabled] = props.playerEnabled;

  return (
    <div class="backtest-ridge-toolbar">
      <span class="backtest-ridge-hint">Molette : zoom · Glisser : déplacer</span>
      <div class="backtest-ridge-toolbar-right">
        <Show when={props.targetDates.length > 1}>
          <label class="backtest-ridge-filter">
            <span>Date cible</span>
            <select
              value={targetDateFilter()}
              onChange={(e) => setTargetDateFilter(e.currentTarget.value)}
            >
              <option value="all">Toutes</option>
              <For each={props.targetDates}>
                {(d) => <option value={d}>{d}</option>}
              </For>
            </select>
          </label>
        </Show>
        <label class="backtest-ridge-filter">
          <span>Derniers ticks</span>
          <select
            value={maxTicks()}
            onChange={(e) => setMaxTicks(Number(e.currentTarget.value))}
          >
            <option value="0">Tous</option>
            <option value="25">25</option>
            <option value="50">50</option>
            <option value="100">100</option>
            <option value="200">200</option>
          </select>
        </label>
        <label class="backtest-ridge-filter">
          <span>Prix min (%)</span>
          <input
            type="number"
            min={0}
            max={100}
            step={1}
            value={minAvgYes()}
            onChange={(e) => {
              const v = Number(e.currentTarget.value);
              setMinAvgYes(Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : 0);
            }}
            class="backtest-ridge-filter-input"
          />
        </label>
        <label class="backtest-ridge-filter">
          <span>Couper sur les trous</span>
          <input
            type="checkbox"
            checked={cutGaps()}
            onChange={(e) => setCutGaps(e.currentTarget.checked)}
          />
        </label>
        <label class="backtest-ridge-filter">
          <span>Entry/Exit hover show</span>
          <input
            type="checkbox"
            checked={showEntryExit()}
            onChange={(e) => setShowEntryExit(e.currentTarget.checked)}
          />
        </label>
        <label class="backtest-ridge-filter">
          <span>Ticks exclus</span>
          <input
            type="checkbox"
            checked={showExcluded()}
            onChange={(e) => setShowExcluded(e.currentTarget.checked)}
          />
        </label>
        <Show when={props.enablePlayer}>
          <label class="backtest-ridge-filter">
            <span>Player</span>
            <input
              type="checkbox"
              checked={playerEnabled()}
              onChange={(e) => setPlayerEnabled(e.currentTarget.checked)}
            />
          </label>
        </Show>
        <button type="button" class="btn btn-sm btn-ghost backtest-ridge-reset-btn" onClick={props.onReset}>
          Réinitialiser
        </button>
      </div>
    </div>
  );
}
